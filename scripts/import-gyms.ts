#!/usr/bin/env tsx
/**
 * 네이버 지역검색 → gyms / gym_branches UPSERT 스크립트
 *
 * 사용 예:
 *   npx tsx scripts/import-gyms.ts                  # 서울 (기본)
 *   npx tsx scripts/import-gyms.ts --region=서울    # 서울만
 *   npx tsx scripts/import-gyms.ts --dry-run         # DB INSERT 없이 미리보기
 *
 * 필수 env (.env.local):
 *   NAVER_SEARCH_CLIENT_ID
 *   NAVER_SEARCH_CLIENT_SECRET
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  RateLimitedError,
  searchLocal,
  type NormalizedHit,
} from "@/lib/server/naver-search";
import { importHits, type SupabaseLikeClient } from "@/lib/server/gym-importer";

// ============================================================
// 1. .env.local 로드 (간단 파서 — dotenv 없이)
// ============================================================
function loadDotenvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(trimmed);
    if (!m) continue;
    const [, key, valRaw] = m;
    if (process.env[key] != null) continue; // 기존 우선
    const val = valRaw.replace(/^['"]|['"]$/g, "");
    process.env[key] = val;
  }
}

loadDotenvLocal();

// ============================================================
// 2. CLI 파라미터
// ============================================================
interface Args {
  region: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { region: "서울", dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--region=")) args.region = a.slice("--region=".length);
  }
  return args;
}

// ============================================================
// 3. 지역 → 키워드 매트릭스
// ============================================================
const SEOUL_GU = [
  "강남구",
  "강동구",
  "강북구",
  "강서구",
  "관악구",
  "광진구",
  "구로구",
  "금천구",
  "노원구",
  "도봉구",
  "동대문구",
  "동작구",
  "마포구",
  "서대문구",
  "서초구",
  "성동구",
  "성북구",
  "송파구",
  "양천구",
  "영등포구",
  "용산구",
  "은평구",
  "종로구",
  "중구",
  "중랑구",
];

const KEYWORDS = ["클라이밍짐", "볼더링", "실내클라이밍", "클라이밍 센터"];

function buildQueries(region: string): string[] {
  if (region === "서울") {
    const queries: string[] = [];
    for (const gu of SEOUL_GU) {
      for (const kw of KEYWORDS) {
        queries.push(`서울 ${gu} ${kw}`);
      }
    }
    return queries;
  }
  // 기타 지역: 시도 + 키워드 단순 조합
  return KEYWORDS.map((kw) => `${region} ${kw}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 4. 진입점
// ============================================================
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret) {
    console.error("ERROR: NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 누락");
    process.exit(1);
  }
  if (!args.dryRun && (!supabaseUrl || !serviceRoleKey)) {
    console.error(
      "ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락 (--dry-run 이 아닌 경우 필수)",
    );
    process.exit(1);
  }

  const queries = buildQueries(args.region);
  console.log(`[start] region=${args.region} dryRun=${args.dryRun} queries=${queries.length}`);

  // 4-1. 모든 query 호출 + 결과 누적
  const allHits: NormalizedHit[] = [];
  const queryErrors: Array<{ query: string; reason: string }> = [];
  const sourceLog: Array<{ name: string; query: string; address: string; link: string | null }> = [];
  let rateLimitedRetried = 0;
  let rateLimitedSkipped = 0;

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const hits = await searchLocal(q, clientId, clientSecret, {
        display: 5,
        onRateLimitRetried: () => {
          rateLimitedRetried++;
        },
      });
      for (const h of hits) {
        allHits.push(h);
        sourceLog.push({ name: h.name, query: q, address: h.address, link: h.link });
      }
      if ((i + 1) % 10 === 0) {
        console.log(`  ... ${i + 1}/${queries.length} (cumulative hits=${allHits.length})`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // 429: 백오프+재시도 후에도 실패한 경우 — 해당 쿼리만 skip, 다음으로 진행
      if (err instanceof RateLimitedError) {
        rateLimitedSkipped++;
        console.warn(`  [rate-limit-skip] ${q}: ${reason}`);
        queryErrors.push({ query: q, reason });
        await sleep(500);
        continue;
      }
      console.error(`  [query-fail] ${q}: ${reason}`);
      queryErrors.push({ query: q, reason });
      // 다른 4xx 는 인증·할당량·키 문제 — 즉시 중단
      if (reason.startsWith("네이버 API 4")) {
        console.error("4xx 응답 감지 — 즉시 중단");
        break;
      }
    }
    await sleep(500);
  }

  // 4-2. DB UPSERT (또는 dry-run)
  const supabaseClient: SupabaseLikeClient = args.dryRun
    ? makeNoopClient()
    : (createClient(supabaseUrl!, serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as SupabaseLikeClient);

  const result = await importHits(allHits, {
    client: supabaseClient,
    dryRun: args.dryRun,
    totalQueries: queries.length,
  });
  for (const e of queryErrors) result.errors.push(e);

  // 4-3. 요약 출력
  console.log("");
  console.log("=== 결과 요약 ===");
  console.log(`총 쿼리:        ${result.totalQueries}`);
  console.log(`총 hit:         ${result.totalHits}`);
  console.log(`중복 제거 후:   ${result.uniqueBranches}`);
  console.log(`INSERT/UPDATE:  ${result.inserted}`);
  console.log(`SKIP (필터):    ${result.skipped}`);
  console.log(`ERROR:          ${result.errors.length}`);
  console.log(`RATE-LIMIT 재시도:  ${rateLimitedRetried}`);
  console.log(`RATE-LIMIT 건너뜀: ${rateLimitedSkipped}`);
  if (result.errors.length > 0) {
    console.log("--- errors (최대 10건) ---");
    for (const e of result.errors.slice(0, 10)) {
      console.log(`  [${e.query}] ${e.reason}`);
    }
  }

  // 4-4. 로그 파일 작성
  writeImportLog({
    args,
    result,
    sourceLog,
    queryErrors,
    rateLimitedRetried,
    rateLimitedSkipped,
  });
}

function makeNoopClient(): SupabaseLikeClient {
  return {
    from: () => ({
      upsert: () => ({
        select: () => Promise.resolve({ data: [], error: null }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  };
}

interface LogArgs {
  args: Args;
  result: Awaited<ReturnType<typeof importHits>>;
  sourceLog: Array<{ name: string; query: string; address: string; link: string | null }>;
  queryErrors: Array<{ query: string; reason: string }>;
  rateLimitedRetried: number;
  rateLimitedSkipped: number;
}

function writeImportLog(input: LogArgs): void {
  const { args, result, sourceLog, queryErrors, rateLimitedRetried, rateLimitedSkipped } = input;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = path.resolve(process.cwd(), "docs/phase-1");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `gym-import-log-${today}.md`);

  const lines: string[] = [];
  lines.push(`# 클라이밍장 자동 수집 로그 (${today})`);
  lines.push("");
  lines.push(`- 출처: 네이버 지역검색 v1 (\`openapi.naver.com/v1/search/local.json\`)`);
  lines.push(`- 실행 모드: ${args.dryRun ? "dry-run (DB INSERT 없음)" : "live UPSERT"}`);
  lines.push(`- 대상 지역: ${args.region}`);
  lines.push(`- 확인 일자: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 요약");
  lines.push("");
  lines.push(`| 항목 | 값 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 총 쿼리 | ${result.totalQueries} |`);
  lines.push(`| 총 hit | ${result.totalHits} |`);
  lines.push(`| unique branch | ${result.uniqueBranches} |`);
  lines.push(`| UPSERT | ${result.inserted} |`);
  lines.push(`| ERROR | ${result.errors.length} |`);
  lines.push(`| RATE-LIMIT 재시도 | ${rateLimitedRetried} |`);
  lines.push(`| RATE-LIMIT 건너뜀 | ${rateLimitedSkipped} |`);
  lines.push("");
  if (queryErrors.length > 0) {
    lines.push("## 쿼리 에러");
    lines.push("");
    for (const e of queryErrors) lines.push(`- \`${e.query}\` — ${e.reason}`);
    lines.push("");
  }
  lines.push("## 수집된 매장 (검색어 출처 포함)");
  lines.push("");
  lines.push("| 매장명 | 검색어 | 주소 | 외부 링크 |");
  lines.push("|--------|--------|------|-----------|");
  for (const s of sourceLog) {
    const link = s.link ? `[link](${s.link})` : "-";
    lines.push(`| ${s.name} | ${s.query} | ${s.address} | ${link} |`);
  }
  lines.push("");

  fs.writeFileSync(file, lines.join("\n"), "utf8");
  console.log(`[log] ${file}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
