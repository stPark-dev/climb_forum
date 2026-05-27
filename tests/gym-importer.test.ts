// gym-importer 단위 테스트 — DB 호출 없이 순수 매핑 함수 + mock client 멱등성.
import { describe, expect, it, vi } from "vitest";
import {
  buildBranchSlug,
  buildGymRow,
  buildGymSlug,
  extractBrand,
  importHits,
  inferFacilityType,
  parseRegion,
  type ImportResult,
  type SupabaseLikeClient,
} from "@/lib/server/gym-importer";
import type { NormalizedHit } from "@/lib/server/naver-search";

const baseHit = (over: Partial<NormalizedHit> = {}): NormalizedHit => ({
  rawTitle: "<b>더클라임</b> 강남점",
  name: "더클라임 강남점",
  category: "스포츠,오락>스포츠시설>실내체육관>클라이밍짐",
  telephone: "02-1234-5678",
  address: "서울특별시 강남구 테헤란로 100",
  lat: 37.5,
  lng: 127.05,
  link: "https://theclimb.kr",
  ...over,
});

// ============================================================
// 1. parseRegion — 주소에서 sido / sgg 추출
// ============================================================
describe("parseRegion", () => {
  it("서울특별시 → '서울'", () => {
    expect(parseRegion("서울특별시 강남구 테헤란로 100")).toEqual({
      sido: "서울",
      sgg: "강남구",
    });
  });

  it("부산광역시 → '부산'", () => {
    expect(parseRegion("부산광역시 해운대구 우동 1234")).toEqual({
      sido: "부산",
      sgg: "해운대구",
    });
  });

  it("경기도 성남시 분당구 — sgg 는 '분당구'", () => {
    expect(parseRegion("경기도 성남시 분당구 정자동 1")).toEqual({
      sido: "경기",
      sgg: "분당구",
    });
  });

  it("경기도 성남시 (구 없음) — sgg 는 '성남시'", () => {
    expect(parseRegion("경기도 성남시 중원로 100")).toEqual({
      sido: "경기",
      sgg: "성남시",
    });
  });

  it("강원특별자치도 → '강원'", () => {
    expect(parseRegion("강원특별자치도 춘천시 명동 1")).toEqual({
      sido: "강원",
      sgg: "춘천시",
    });
  });

  it("세종특별자치시 — sgg 는 '세종시'", () => {
    expect(parseRegion("세종특별자치시 한누리대로 100")).toEqual({
      sido: "세종",
      sgg: "세종시",
    });
  });

  it("제주특별자치도 제주시 → ('제주','제주시')", () => {
    expect(parseRegion("제주특별자치도 제주시 연동 100")).toEqual({
      sido: "제주",
      sgg: "제주시",
    });
  });

  it("앞에 공백·기호 있어도 처리", () => {
    expect(parseRegion("  서울특별시 강남구 1")).toEqual({
      sido: "서울",
      sgg: "강남구",
    });
  });

  it("파싱 실패 시 throw", () => {
    expect(() => parseRegion("외국 어딘가 1번지")).toThrow();
    expect(() => parseRegion("")).toThrow();
  });
});

// ============================================================
// 2. extractBrand — 매장명에서 브랜드/지점 분리
// ============================================================
describe("extractBrand", () => {
  it("'더클라임 강남점' → 브랜드 '더클라임', 지점 '강남점'", () => {
    expect(extractBrand("더클라임 강남점")).toEqual({
      brand: "더클라임",
      branchSuffix: "강남점",
      isChain: true,
    });
  });

  it("'볼더월드 홍대지점' → 브랜드 '볼더월드'", () => {
    expect(extractBrand("볼더월드 홍대지점")).toEqual({
      brand: "볼더월드",
      branchSuffix: "홍대지점",
      isChain: true,
    });
  });

  it("'락앤웨이브 센터' — 단일 매장 (지점이 아닌 일반 '센터')", () => {
    const r = extractBrand("락앤웨이브");
    expect(r.isChain).toBe(false);
    expect(r.brand).toBe("락앤웨이브");
  });

  it("공백 정리", () => {
    expect(extractBrand("  플라스틱마운틴   강북점  ")).toEqual({
      brand: "플라스틱마운틴",
      branchSuffix: "강북점",
      isChain: true,
    });
  });

  it("점 접미사가 없으면 independent", () => {
    expect(extractBrand("아이클라임").isChain).toBe(false);
  });
});

// ============================================================
// 3. buildGymSlug / buildBranchSlug — 결정성·형식
// ============================================================
describe("buildGymSlug", () => {
  it("동일 입력 → 동일 slug (결정성)", () => {
    expect(buildGymSlug("더클라임")).toBe(buildGymSlug("더클라임"));
  });

  it("DB CHECK 형식 통과 (^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$)", () => {
    const slug = buildGymSlug("더클라임");
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);
  });

  it("다른 브랜드는 다른 slug (충돌 가능성 작음)", () => {
    expect(buildGymSlug("더클라임")).not.toBe(buildGymSlug("볼더월드"));
  });

  it("길이는 64자 이하", () => {
    const slug = buildGymSlug("아주아주 매우매우 긴 클라이밍 브랜드 이름 입니다 정말로요");
    expect(slug.length).toBeLessThanOrEqual(64);
  });
});

describe("buildBranchSlug", () => {
  it("동일 주소+이름 → 동일 slug", () => {
    const s1 = buildBranchSlug("더클라임 강남점", "서울특별시 강남구 테헤란로 100");
    const s2 = buildBranchSlug("더클라임 강남점", "서울특별시 강남구 테헤란로 100");
    expect(s1).toBe(s2);
  });

  it("주소가 다르면 slug 도 다름", () => {
    const s1 = buildBranchSlug("더클라임 강남점", "서울특별시 강남구 테헤란로 100");
    const s2 = buildBranchSlug("더클라임 강남점", "서울특별시 강남구 테헤란로 200");
    expect(s1).not.toBe(s2);
  });

  it("형식: branch slug 규칙 통과 (3~82자)", () => {
    const s = buildBranchSlug("더클라임 강남점", "서울특별시 강남구 테헤란로 100");
    expect(s).toMatch(/^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/);
  });
});

// ============================================================
// 4. inferFacilityType
// ============================================================
describe("inferFacilityType", () => {
  it("볼더링 키워드 → bouldering", () => {
    expect(inferFacilityType("스포츠시설>볼더링짐", "볼더 전문")).toBe("bouldering");
  });

  it("리드 키워드 → lead", () => {
    expect(inferFacilityType("스포츠시설>리드 클라이밍", "")).toBe("lead");
  });

  it("둘 다 → both", () => {
    expect(inferFacilityType("스포츠시설>클라이밍", "볼더링과 리드 모두")).toBe("both");
  });

  it("불명확 → bouldering 기본", () => {
    expect(inferFacilityType("클라이밍짐", "")).toBe("bouldering");
  });
});

// ============================================================
// 5. buildGymRow — chain vs independent 분기
// ============================================================
describe("buildGymRow", () => {
  it("chain 브랜드 행", () => {
    const r = buildGymRow(baseHit({ name: "더클라임 강남점" }));
    expect(r.brand_type).toBe("chain");
    expect(r.name_ko).toBe("더클라임");
    expect(r.is_active).toBe(true);
  });

  it("independent 매장 행 — 매장명 그대로", () => {
    const r = buildGymRow(baseHit({ name: "락앤웨이브" }));
    expect(r.brand_type).toBe("independent");
    expect(r.name_ko).toBe("락앤웨이브");
  });

  it("website_url 은 link 값 (https 만 허용 — http 도 통과해야 DB CHECK 와 일치)", () => {
    const r = buildGymRow(baseHit({ link: "http://example.com" }));
    expect(r.website_url).toBe("http://example.com");
  });

  it("link 없으면 website_url null", () => {
    const r = buildGymRow(baseHit({ link: null }));
    expect(r.website_url).toBeNull();
  });
});

// ============================================================
// 6. importHits — mock supabase client 로 멱등성 검증
// ============================================================
describe("importHits", () => {
  // 간단한 인메모리 mock client
  function makeMockClient(): SupabaseLikeClient & {
    _gyms: Map<string, Record<string, unknown>>;
    _branches: Map<string, Record<string, unknown>>;
    _gymsUpsertCalls: number;
    _branchesUpsertCalls: number;
  } {
    const gyms = new Map<string, Record<string, unknown>>();
    const branches = new Map<string, Record<string, unknown>>();
    let gymsUpsertCalls = 0;
    let branchesUpsertCalls = 0;

    const makeBuilder = (table: "gyms" | "gym_branches") => {
      // Supabase upsert(rows, { onConflict }).select() 모양만 흉내
      return {
        upsert: (rows: Record<string, unknown>[], _opts: { onConflict?: string }) => {
          if (table === "gyms") gymsUpsertCalls += rows.length;
          else branchesUpsertCalls += rows.length;
          const target = table === "gyms" ? gyms : branches;
          const inserted: Record<string, unknown>[] = [];
          for (const row of rows) {
            const slug = String(row.slug);
            const existed = target.get(slug);
            const merged = existed
              ? { ...existed, ...row, id: existed.id, updated_at: new Date().toISOString() }
              : { ...row, id: `mock-${table}-${slug}`, updated_at: new Date().toISOString() };
            target.set(slug, merged);
            inserted.push(merged);
          }
          return {
            select: () => Promise.resolve({ data: inserted, error: null }),
          };
        },
        select: (_cols: string) => ({
          eq: (_k: string, _v: string) => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    };

    return {
      from: (table: string) => {
        if (table === "gyms") return makeBuilder("gyms");
        if (table === "gym_branches") return makeBuilder("gym_branches");
        throw new Error(`unexpected table: ${table}`);
      },
      _gyms: gyms,
      _branches: branches,
      get _gymsUpsertCalls() {
        return gymsUpsertCalls;
      },
      get _branchesUpsertCalls() {
        return branchesUpsertCalls;
      },
    } as never;
  }

  it("같은 hit 두 번 실행 → 행 수 동일 (멱등성)", async () => {
    const client = makeMockClient();
    const hits = [baseHit()];

    const r1 = await importHits(hits, { client });
    const r2 = await importHits(hits, { client });

    expect(r1.uniqueBranches).toBe(1);
    expect(r2.uniqueBranches).toBe(1);
    // 두번째도 UPSERT 는 호출되지만 행 수는 그대로
    expect(client._gyms.size).toBe(1);
    expect(client._branches.size).toBe(1);
  });

  it("브랜드 + 같은 브랜드의 다른 지점 → gym 1개 + branch 2개", async () => {
    const client = makeMockClient();
    const hits = [
      baseHit({
        name: "더클라임 강남점",
        address: "서울특별시 강남구 테헤란로 100",
      }),
      baseHit({
        name: "더클라임 홍대점",
        address: "서울특별시 마포구 양화로 200",
      }),
    ];

    const r = await importHits(hits, { client });
    expect(r.uniqueBranches).toBe(2);
    expect(client._gyms.size).toBe(1);
    expect(client._branches.size).toBe(2);
  });

  it("같은 입력 중복 제거", async () => {
    const client = makeMockClient();
    const hits = [baseHit(), baseHit()];
    const r = await importHits(hits, { client });
    expect(r.totalHits).toBe(2);
    expect(r.uniqueBranches).toBe(1);
  });

  it("dry-run 모드 — DB 호출 없음", async () => {
    const client = makeMockClient();
    const r = await importHits([baseHit()], { client, dryRun: true });
    expect(r.uniqueBranches).toBe(1);
    expect(client._gyms.size).toBe(0);
    expect(client._branches.size).toBe(0);
  });

  it("주소 파싱 실패 hit 은 errors 에 기록", async () => {
    const client = makeMockClient();
    const bad = baseHit({ address: "외국주소 어딘가" });
    const r = await importHits([bad], { client });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.uniqueBranches).toBe(0);
  });

  it("Supabase 에러 발생 시 errors 배열에 기록", async () => {
    const errorClient: SupabaseLikeClient = {
      from: (_table: string) => ({
        upsert: () => ({
          select: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    };
    const r = await importHits([baseHit()], { client: errorClient });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("ImportResult 형식 검증", async () => {
    const client = makeMockClient();
    const r: ImportResult = await importHits([baseHit()], { client });
    expect(r.totalHits).toBe(1);
    expect(typeof r.inserted).toBe("number");
    expect(typeof r.updated).toBe("number");
    expect(typeof r.skipped).toBe("number");
    expect(Array.isArray(r.errors)).toBe(true);
  });
});
