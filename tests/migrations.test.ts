import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIG_DIR = path.resolve(__dirname, "..", "supabase", "migrations");

function loadAllMigrations(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  return files.map((f) => readFileSync(path.join(MIG_DIR, f), "utf8")).join("\n\n");
}

// 마이그레이션 SQL 전체를 한 문자열로 합쳐 분석한다.
const sql = loadAllMigrations();

// `create table [if not exists] public.X (`  또는  `create table public.X (`
function extractCreatedTables(source: string): string[] {
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) found.add(m[1].toLowerCase());
  return [...found];
}

function tablesWithRlsEnabled(source: string): Set<string> {
  const re = /alter\s+table\s+public\.([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) found.add(m[1].toLowerCase());
  return found;
}

function tablesWithPolicy(source: string): Set<string> {
  // create policy "name" on public.X
  const re = /create\s+policy\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) found.add(m[1].toLowerCase());
  return found;
}

function tablesWithForceRls(source: string): Set<string> {
  const re = /alter\s+table\s+public\.([a-z_][a-z0-9_]*)\s+force\s+row\s+level\s+security/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) found.add(m[1].toLowerCase());
  return found;
}

function hasPolicyOn(source: string, table: string, command: "select" | "insert" | "update" | "delete"): boolean {
  const re = new RegExp(
    String.raw`create\s+policy\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+public\.${table}\b[\s\S]*?\bfor\s+${command}\b`,
    "i",
  );
  return re.test(source);
}

function hasIndex(source: string, name: string): boolean {
  const re = new RegExp(String.raw`create\s+index\s+(?:if\s+not\s+exists\s+)?${name}\b`, "i");
  return re.test(source);
}

describe("마이그레이션 무결성", () => {
  it("마이그레이션 파일이 존재한다", () => {
    const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("required 핵심 테이블 모두 생성", () => {
    const created = extractCreatedTables(sql);
    for (const t of ["roles", "user_levels", "profiles", "audit_log"]) {
      expect(created).toContain(t);
    }
  });

  it("모든 신규 public 테이블에 RLS enable", () => {
    const created = extractCreatedTables(sql);
    const rlsEnabled = tablesWithRlsEnabled(sql);
    const missing = created.filter((t) => !rlsEnabled.has(t));
    expect(missing, `RLS 미적용 테이블: ${missing.join(", ")}`).toEqual([]);
  });

  it("모든 RLS 활성 테이블에 최소 1개 정책", () => {
    const rlsEnabled = tablesWithRlsEnabled(sql);
    const policied = tablesWithPolicy(sql);
    const missing = [...rlsEnabled].filter((t) => !policied.has(t));
    expect(missing, `정책 없는 RLS 테이블: ${missing.join(", ")}`).toEqual([]);
  });

  it("profiles 테이블에 role_id FK + level FK", () => {
    expect(sql).toMatch(/role_id[\s\S]*?references\s+public\.roles\s*\(\s*id\s*\)/i);
    expect(sql).toMatch(/level[\s\S]*?references\s+public\.user_levels\s*\(\s*level\s*\)/i);
  });

  it("handle_new_user 트리거 정의됨", () => {
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.handle_new_user/i);
    expect(sql).toMatch(/create\s+trigger\s+on_auth_user_created[\s\S]*after\s+insert\s+on\s+auth\.users/i);
  });

  it("has_role / is_admin 함수 정의됨 + SECURITY DEFINER + search_path 고정", () => {
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.has_role/i);
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.is_admin/i);
    // SECURITY DEFINER 함수는 search_path 고정 필수 (인젝션 방어)
    const definerBlocks = sql.match(/security\s+definer[\s\S]*?\$\$/gi) ?? [];
    expect(definerBlocks.length).toBeGreaterThan(0);
    for (const block of definerBlocks) {
      expect(block).toMatch(/set\s+search_path\s*=/i);
    }
  });

  it("기본 권한 — anon에는 select만, authenticated에는 select/insert/update만", () => {
    // anon 권한이 너무 넓지 않은지 가벼운 검증
    expect(sql).toMatch(/grant\s+select\s+on[\s\S]*?to\s+anon/i);
    expect(sql).not.toMatch(/grant\s+(?:all|delete|truncate)\s+on[\s\S]*?to\s+anon/i);
  });
});

describe("gyms 도메인 마이그레이션", () => {
  const GYM_TABLES = ["gyms", "gym_branches", "gym_hours", "gym_pricing"] as const;

  it("4개 신규 테이블 모두 생성", () => {
    const created = extractCreatedTables(sql);
    for (const t of GYM_TABLES) {
      expect(created, `누락: ${t}`).toContain(t);
    }
  });

  it("4개 신규 테이블 모두 RLS ENABLE + FORCE", () => {
    const enabled = tablesWithRlsEnabled(sql);
    const forced = tablesWithForceRls(sql);
    for (const t of GYM_TABLES) {
      expect(enabled.has(t), `${t}: RLS enable 누락`).toBe(true);
      expect(forced.has(t), `${t}: RLS force 누락`).toBe(true);
    }
  });

  it("각 테이블에 SELECT 정책 존재", () => {
    for (const t of GYM_TABLES) {
      expect(hasPolicyOn(sql, t, "select"), `${t}: SELECT 정책 누락`).toBe(true);
    }
  });

  it("각 테이블에 INSERT/UPDATE 정책 존재", () => {
    for (const t of GYM_TABLES) {
      expect(hasPolicyOn(sql, t, "insert"), `${t}: INSERT 정책 누락`).toBe(true);
      expect(hasPolicyOn(sql, t, "update"), `${t}: UPDATE 정책 누락`).toBe(true);
    }
  });

  function extractPolicyBlock(
    source: string,
    table: string,
    command: "select" | "insert" | "update" | "delete",
  ): string | null {
    // 각 `create policy ... on public.<table>` 블록을 찾고, 그 안의 for <command> 만 매치
    const policyRe = new RegExp(
      String.raw`create\s+policy\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+public\.${table}\b[\s\S]*?;`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = policyRe.exec(source)) !== null) {
      const block = m[0];
      const forRe = new RegExp(String.raw`\bfor\s+${command}\b`, "i");
      if (forRe.test(block)) return block;
    }
    return null;
  }

  it("DELETE는 관리자만 — is_admin() 조건 포함, curator 금지", () => {
    for (const t of GYM_TABLES) {
      expect(hasPolicyOn(sql, t, "delete"), `${t}: DELETE 정책 누락`).toBe(true);
      const block = extractPolicyBlock(sql, t, "delete");
      expect(block, `${t}: DELETE 정책 블록 추출 실패`).not.toBeNull();
      expect(block!).not.toMatch(/has_role\(\s*'curator'\s*\)/i);
      expect(block!).toMatch(/is_admin\(\s*\)/i);
    }
  });

  it("INSERT/UPDATE 정책은 curator 또는 admin 만", () => {
    for (const t of GYM_TABLES) {
      for (const cmd of ["insert", "update"] as const) {
        const block = extractPolicyBlock(sql, t, cmd);
        expect(block, `${t} ${cmd} 정책 블록 추출 실패`).not.toBeNull();
        const hasCurator = /has_role\(\s*'curator'\s*\)/i.test(block!);
        const hasAdmin = /is_admin\(\s*\)/i.test(block!);
        expect(hasCurator && hasAdmin, `${t} ${cmd}: curator OR admin 조건 누락`).toBe(true);
      }
    }
  });

  it("필수 인덱스 존재 (region, geo, branch_id, hours, pricing)", () => {
    expect(hasIndex(sql, "idx_branches_region"), "idx_branches_region 누락").toBe(true);
    expect(hasIndex(sql, "idx_branches_geo"), "idx_branches_geo 누락").toBe(true);
    expect(hasIndex(sql, "idx_branches_gym_id"), "idx_branches_gym_id 누락").toBe(true);
    expect(hasIndex(sql, "idx_hours_branch"), "idx_hours_branch 누락").toBe(true);
    expect(hasIndex(sql, "idx_pricing_branch"), "idx_pricing_branch 누락").toBe(true);
  });

  it("gym_branches: gyms FK ON DELETE RESTRICT", () => {
    expect(sql).toMatch(
      /gym_id[\s\S]*?references\s+public\.gyms\s*\(\s*id\s*\)[\s\S]*?on\s+delete\s+restrict/i,
    );
  });

  it("gym_hours / gym_pricing: branch FK ON DELETE CASCADE", () => {
    expect(sql).toMatch(
      /create\s+table[\s\S]*?public\.gym_hours[\s\S]*?references\s+public\.gym_branches\s*\(\s*id\s*\)[\s\S]*?on\s+delete\s+cascade/i,
    );
    expect(sql).toMatch(
      /create\s+table[\s\S]*?public\.gym_pricing[\s\S]*?references\s+public\.gym_branches\s*\(\s*id\s*\)[\s\S]*?on\s+delete\s+cascade/i,
    );
  });

  it("gyms 도메인 권한 — anon SELECT, authenticated INSERT/UPDATE/DELETE", () => {
    expect(sql).toMatch(
      /grant\s+select\s+on\s+public\.gyms[\s\S]*?to\s+anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+insert\s*,\s*update\s*,\s*delete\s+on\s+public\.gyms[\s\S]*?to\s+authenticated/i,
    );
  });

  it("gym_branches SELECT 정책은 부모 gym 활성 검사를 포함한다", () => {
    // create policy gym_branches_read_active ... for select using ( ... );
    const re =
      /create\s+policy\s+gym_branches_read_active\s+on\s+public\.gym_branches[\s\S]*?for\s+select[\s\S]*?;/i;
    const m = re.exec(sql);
    expect(m, "gym_branches_read_active 정책 블록을 찾지 못함").not.toBeNull();
    const block = m![0];
    // 부모 gyms 테이블에 대한 exists 서브쿼리 + gyms.is_active = true 가 있어야 한다
    expect(block).toMatch(/exists\s*\(\s*select\s+1\s+from\s+public\.gyms\b/i);
    expect(block).toMatch(/g\.is_active\s*=\s*true/i);
  });
});
