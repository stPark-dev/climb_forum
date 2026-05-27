// 서버 전용 — 네이버 지역검색 결과를 DB 행으로 변환 + UPSERT
//
// 제약:
// - service_role 키는 호출부(scripts/)에서 주입. 이 모듈은 토큰 모름.
// - 멱등성: 동일 입력 N회 실행해도 row 수 변화 없고 updated_at 만 갱신.
// - hours / pricing 은 건드리지 않는다 (admin UI 영역).

import { createHash } from "node:crypto";
import type { BrandType, FacilityType } from "@/lib/types/gyms";
import type { NormalizedHit } from "@/lib/server/naver-search";

// ============================================================
// 1. 지역 파싱 — "서울특별시 강남구 ..." → { sido: '서울', sgg: '강남구' }
// ============================================================
const SIDO_MAP: Array<{ prefix: string; sido: string }> = [
  { prefix: "서울특별시", sido: "서울" },
  { prefix: "서울시", sido: "서울" },
  { prefix: "서울", sido: "서울" },
  { prefix: "부산광역시", sido: "부산" },
  { prefix: "부산시", sido: "부산" },
  { prefix: "부산", sido: "부산" },
  { prefix: "대구광역시", sido: "대구" },
  { prefix: "대구", sido: "대구" },
  { prefix: "인천광역시", sido: "인천" },
  { prefix: "인천", sido: "인천" },
  { prefix: "광주광역시", sido: "광주" },
  { prefix: "광주", sido: "광주" },
  { prefix: "대전광역시", sido: "대전" },
  { prefix: "대전", sido: "대전" },
  { prefix: "울산광역시", sido: "울산" },
  { prefix: "울산", sido: "울산" },
  { prefix: "세종특별자치시", sido: "세종" },
  { prefix: "세종시", sido: "세종" },
  { prefix: "세종", sido: "세종" },
  { prefix: "경기도", sido: "경기" },
  { prefix: "경기", sido: "경기" },
  { prefix: "강원특별자치도", sido: "강원" },
  { prefix: "강원도", sido: "강원" },
  { prefix: "강원", sido: "강원" },
  { prefix: "충청북도", sido: "충북" },
  { prefix: "충북", sido: "충북" },
  { prefix: "충청남도", sido: "충남" },
  { prefix: "충남", sido: "충남" },
  { prefix: "전북특별자치도", sido: "전북" },
  { prefix: "전라북도", sido: "전북" },
  { prefix: "전북", sido: "전북" },
  { prefix: "전라남도", sido: "전남" },
  { prefix: "전남", sido: "전남" },
  { prefix: "경상북도", sido: "경북" },
  { prefix: "경북", sido: "경북" },
  { prefix: "경상남도", sido: "경남" },
  { prefix: "경남", sido: "경남" },
  { prefix: "제주특별자치도", sido: "제주" },
  { prefix: "제주도", sido: "제주" },
  { prefix: "제주", sido: "제주" },
];

export function parseRegion(address: string): { sido: string; sgg: string } {
  const trimmed = (address ?? "").trim();
  if (trimmed.length === 0) {
    throw new Error("주소가 비어 있습니다");
  }

  for (const { prefix, sido } of SIDO_MAP) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trim();
      // 세종특별자치시는 시/군/구 단위 없이 바로 도로명/동
      if (sido === "세종") {
        return { sido, sgg: "세종시" };
      }
      const sgg = extractSgg(rest, sido);
      if (sgg) return { sido, sgg };
    }
  }
  throw new Error(`주소에서 시도 파싱 실패: ${trimmed}`);
}

function extractSgg(rest: string, sido: string): string | null {
  // 첫 토큰을 가져와 끝이 시/군/구 인지 확인
  // 예: "성남시 분당구 정자동" → "성남시" + "분당구"
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const first = tokens[0];
  const second = tokens[1];

  // 광역시·특별시 산하: 첫 토큰이 자치구 (~구)
  if (["서울", "부산", "대구", "인천", "광주", "대전", "울산"].includes(sido)) {
    if (/구$/.test(first)) return first;
    if (/군$/.test(first)) return first; // 부산 기장군 등
    return null;
  }

  // 도 단위: 첫 토큰이 시/군. 두 번째 토큰이 ~구 면 (분당구·일산구 등) 두번째 선호
  if (/(시|군)$/.test(first)) {
    if (second && /구$/.test(second)) return second;
    return first;
  }
  return null;
}

// ============================================================
// 2. 브랜드 추출 — "더클라임 강남점" → 브랜드 "더클라임", 지점 "강남점"
// ============================================================
const BRANCH_SUFFIX_RE = /\s+([가-힣A-Za-z0-9]+(?:점|지점))$/;

export interface BrandInfo {
  brand: string;
  branchSuffix: string | null;
  isChain: boolean;
}

export function extractBrand(name: string): BrandInfo {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const m = BRANCH_SUFFIX_RE.exec(trimmed);
  if (m) {
    const brand = trimmed.slice(0, m.index).trim();
    if (brand.length > 0) {
      return { brand, branchSuffix: m[1], isChain: true };
    }
  }
  return { brand: trimmed, branchSuffix: null, isChain: false };
}

// ============================================================
// 3. slug 생성 (해시 기반 — DB CHECK 정규식 통과)
// ============================================================
// DB 정규식: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$ (3~64)
// 한글 매장명은 정규식 불가 → 결정적 해시로 영소문자+숫자 slug 생성.
function hashHex(input: string, len: number): string {
  return createHash("sha1").update(input).digest("hex").slice(0, len);
}

export function buildGymSlug(brand: string): string {
  const hex = hashHex(`gym|${brand.trim()}`, 12);
  // 형식: gym-<12hex> = 16자, 시작·끝 영숫자, 중간에 하이픈 — CHECK 통과
  return `gym-${hex}`;
}

export function buildBranchSlug(name: string, address: string): string {
  const hex = hashHex(`branch|${name.trim()}|${address.trim()}`, 16);
  return `branch-${hex}`;
}

// ============================================================
// 4. facility_type 추론
// ============================================================
export function inferFacilityType(category: string, description: string): FacilityType {
  const text = `${category} ${description ?? ""}`;
  const hasLead = /리드|lead/i.test(text);
  const hasBoulder = /볼더|boulder/i.test(text);
  if (hasLead && hasBoulder) return "both";
  if (hasLead) return "lead";
  return "bouldering";
}

// ============================================================
// 5. DB row 빌더
// ============================================================
export interface GymInsertRow {
  slug: string;
  name_ko: string;
  brand_type: BrandType;
  website_url: string | null;
  is_active: boolean;
}

export interface GymBranchInsertRow {
  gym_slug: string; // join 용 (실제 INSERT 시 gym_id 로 변환)
  slug: string;
  name_ko: string;
  region_sido: string;
  region_sgg: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  facility_type: FacilityType;
  is_active: boolean;
}

export function buildGymRow(hit: NormalizedHit): GymInsertRow {
  const brand = extractBrand(hit.name);
  return {
    slug: buildGymSlug(brand.brand),
    name_ko: brand.brand.slice(0, 100),
    brand_type: brand.isChain ? "chain" : "independent",
    // DB CHECK 는 http/https 모두 허용 (^https?://). 그대로 통과.
    website_url: hit.link,
    is_active: true,
  };
}

export function buildBranchRow(hit: NormalizedHit, description = ""): GymBranchInsertRow {
  const brand = extractBrand(hit.name);
  const region = parseRegion(hit.address);
  return {
    gym_slug: buildGymSlug(brand.brand),
    slug: buildBranchSlug(hit.name, hit.address),
    name_ko: hit.name.slice(0, 120),
    region_sido: region.sido,
    region_sgg: region.sgg,
    address: hit.address.slice(0, 200),
    // DB 는 numeric(10,7) — 소수점 7자리까지 안전
    lat: roundTo(hit.lat, 7),
    lng: roundTo(hit.lng, 7),
    phone: hit.telephone,
    facility_type: inferFacilityType(hit.category, description),
    is_active: true,
  };
}

function roundTo(n: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

// ============================================================
// 6. Supabase 클라이언트 인터페이스 (테스트 가능하도록 추상화)
// ============================================================
export interface UpsertResult {
  data: Array<{ id: string; slug: string } & Record<string, unknown>> | null;
  error: { message: string } | null;
}

export interface SupabaseLikeClient {
  from(table: string): {
    upsert(
      rows: Record<string, unknown>[],
      opts: { onConflict?: string },
    ): {
      select(cols?: string): Promise<UpsertResult>;
    };
    select(cols: string): {
      eq(
        col: string,
        val: string,
      ): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
      };
    };
  };
}

// ============================================================
// 7. importHits — 메인 진입점
// ============================================================
export interface ImportResult {
  totalQueries: number;
  totalHits: number;
  uniqueBranches: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ query: string; reason: string }>;
}

export interface ImportOptions {
  client: SupabaseLikeClient;
  dryRun?: boolean;
  totalQueries?: number; // 호출자가 보고용으로 주입
}

export async function importHits(
  hits: NormalizedHit[],
  opts: ImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = {
    totalQueries: opts.totalQueries ?? 0,
    totalHits: hits.length,
    uniqueBranches: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // 1. 중복 제거 (slug 기준) + 행 빌드
  const gymRowsBySlug = new Map<string, GymInsertRow>();
  const branchRowsBySlug = new Map<string, GymBranchInsertRow>();

  for (const hit of hits) {
    try {
      const gymRow = buildGymRow(hit);
      const branchRow = buildBranchRow(hit);
      gymRowsBySlug.set(gymRow.slug, gymRow);
      branchRowsBySlug.set(branchRow.slug, branchRow);
    } catch (err) {
      result.errors.push({
        query: hit.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  result.uniqueBranches = branchRowsBySlug.size;

  if (opts.dryRun) {
    return result;
  }

  // 2. gyms UPSERT
  const gymSlugToId = new Map<string, string>();
  if (gymRowsBySlug.size > 0) {
    const gymsTable = opts.client.from("gyms");
    const gymRows = Array.from(gymRowsBySlug.values()).map((r) => ({
      slug: r.slug,
      name_ko: r.name_ko,
      brand_type: r.brand_type,
      website_url: r.website_url,
      is_active: r.is_active,
    }));
    const { data, error } = await gymsTable
      .upsert(gymRows, { onConflict: "slug" })
      .select("id, slug");
    if (error) {
      result.errors.push({ query: "gyms upsert", reason: error.message });
      return result;
    }
    for (const row of data ?? []) {
      gymSlugToId.set(row.slug, row.id);
    }
  }

  // 3. branches UPSERT
  if (branchRowsBySlug.size > 0) {
    const branchesTable = opts.client.from("gym_branches");
    const branchRows: Record<string, unknown>[] = [];
    for (const br of branchRowsBySlug.values()) {
      const gymId = gymSlugToId.get(br.gym_slug);
      if (!gymId) {
        result.errors.push({
          query: br.slug,
          reason: `gym_id 누락 (gym_slug=${br.gym_slug})`,
        });
        continue;
      }
      branchRows.push({
        gym_id: gymId,
        slug: br.slug,
        name_ko: br.name_ko,
        region_sido: br.region_sido,
        region_sgg: br.region_sgg,
        address: br.address,
        lat: br.lat,
        lng: br.lng,
        phone: br.phone,
        facility_type: br.facility_type,
        is_active: br.is_active,
      });
    }

    if (branchRows.length > 0) {
      const { data, error } = await branchesTable
        .upsert(branchRows, { onConflict: "slug" })
        .select("id, slug");
      if (error) {
        result.errors.push({ query: "gym_branches upsert", reason: error.message });
        return result;
      }
      // upsert 결과로 신규/기존 구분이 어려우므로 합쳐서 inserted 로 카운트
      result.inserted = (data ?? []).length;
    }
  }

  return result;
}
