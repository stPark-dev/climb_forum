import { describe, it, expect } from "vitest";
import {
  branchSlugSchema,
  formatKrw,
  formatTime,
  gymSlugSchema,
  listGymsInputSchema,
  parseListGymsQuery,
  sortHoursByDay,
  sortPricing,
  type GymHourRow,
  type GymPricingRow,
} from "@/lib/types/gyms";

describe("gymSlugSchema", () => {
  it("정상 slug 통과", () => {
    expect(gymSlugSchema.safeParse("the-climb").success).toBe(true);
    expect(gymSlugSchema.safeParse("ascend123").success).toBe(true);
    expect(gymSlugSchema.safeParse("abc").success).toBe(true);
  });

  it("규칙 위반 — 대문자·언더스코어·시작·끝 하이픈", () => {
    expect(gymSlugSchema.safeParse("The-Climb").success).toBe(false);
    expect(gymSlugSchema.safeParse("the_climb").success).toBe(false);
    expect(gymSlugSchema.safeParse("-the-climb").success).toBe(false);
    expect(gymSlugSchema.safeParse("the-climb-").success).toBe(false);
    expect(gymSlugSchema.safeParse("a").success).toBe(false); // 너무 짧음 (총 3자 미만)
    expect(gymSlugSchema.safeParse("ab").success).toBe(false);
  });

  it("길이 상한 (gym slug 최대 64자)", () => {
    const max = "a" + "b".repeat(62) + "c"; // 64자
    expect(gymSlugSchema.safeParse(max).success).toBe(true);
    const over = "a" + "b".repeat(63) + "c"; // 65자
    expect(gymSlugSchema.safeParse(over).success).toBe(false);
  });

  it("SQL 인젝션 시도 차단", () => {
    expect(gymSlugSchema.safeParse("a'; drop table").success).toBe(false);
    expect(gymSlugSchema.safeParse("a/b").success).toBe(false);
  });
});

describe("branchSlugSchema", () => {
  it("길이 상한 (branch slug 최대 82자)", () => {
    const max = "a" + "b".repeat(80) + "c"; // 82자
    expect(branchSlugSchema.safeParse(max).success).toBe(true);
    const over = "a" + "b".repeat(81) + "c"; // 83자
    expect(branchSlugSchema.safeParse(over).success).toBe(false);
  });
});

describe("listGymsInputSchema", () => {
  it("빈 입력은 기본값 채움", () => {
    const r = listGymsInputSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
    expect(r.sido).toBeUndefined();
    expect(r.facility).toBeUndefined();
  });

  it("facility enum 검증", () => {
    expect(listGymsInputSchema.safeParse({ facility: "bouldering" }).success).toBe(true);
    expect(listGymsInputSchema.safeParse({ facility: "lead" }).success).toBe(true);
    expect(listGymsInputSchema.safeParse({ facility: "both" }).success).toBe(true);
    expect(listGymsInputSchema.safeParse({ facility: "unknown" }).success).toBe(false);
  });

  it("page 음수·과대 차단", () => {
    expect(listGymsInputSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listGymsInputSchema.safeParse({ page: -1 }).success).toBe(false);
    expect(listGymsInputSchema.safeParse({ page: 1001 }).success).toBe(false);
    expect(listGymsInputSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});

describe("parseListGymsQuery", () => {
  it("URL 쿼리 (string|string[]) 안전 파싱", () => {
    expect(parseListGymsQuery({ sido: "서울", facility: "bouldering" })).toEqual({
      sido: "서울",
      facility: "bouldering",
      page: 1,
      pageSize: 20,
    });
  });

  it("배열 입력은 첫 값만", () => {
    expect(parseListGymsQuery({ sido: ["서울", "부산"] }).sido).toBe("서울");
  });

  it("빈 문자열은 undefined 로 정규화", () => {
    expect(parseListGymsQuery({ sido: "" }).sido).toBeUndefined();
  });

  it("정상치 못한 facility 는 throw", () => {
    expect(() => parseListGymsQuery({ facility: "invalid" })).toThrow();
  });

  it("page 가 NaN 이면 1 로 정규화", () => {
    expect(parseListGymsQuery({ page: "abc" }).page).toBe(1);
  });

  it("page 가 음수면 throw", () => {
    expect(() => parseListGymsQuery({ page: "-3" })).toThrow();
  });
});

describe("sortPricing", () => {
  const mk = (over: Partial<GymPricingRow>): GymPricingRow => ({
    id: over.id ?? "id-x",
    branch_id: "b1",
    pricing_type: "day_pass",
    label_ko: "라벨",
    price_krw: over.price_krw ?? 0,
    unit: null,
    note: null,
    effective_from: null,
    effective_until: null,
    sort_order: over.sort_order ?? 100,
  });

  it("sort_order 오름차순 우선", () => {
    const rows = [mk({ id: "a", sort_order: 30 }), mk({ id: "b", sort_order: 10 }), mk({ id: "c", sort_order: 20 })];
    expect(sortPricing(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("동일 sort_order 에서는 price 오름차순", () => {
    const rows = [
      mk({ id: "a", sort_order: 10, price_krw: 30000 }),
      mk({ id: "b", sort_order: 10, price_krw: 10000 }),
      mk({ id: "c", sort_order: 10, price_krw: 20000 }),
    ];
    expect(sortPricing(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("원본 불변 (immutability)", () => {
    const rows = [mk({ id: "a", sort_order: 30 }), mk({ id: "b", sort_order: 10 })];
    const copy = [...rows];
    sortPricing(rows);
    expect(rows).toEqual(copy);
  });
});

describe("sortHoursByDay", () => {
  const mk = (day_type: GymHourRow["day_type"], effective_from = "2026-01-01"): GymHourRow => ({
    id: `${day_type}-${effective_from}`,
    branch_id: "b1",
    day_type,
    open_time: "10:00:00",
    close_time: "22:00:00",
    is_closed: false,
    note: null,
    effective_from,
  });

  it("월→일→공휴일 순서", () => {
    const rows = [mk("holiday"), mk("sun"), mk("mon"), mk("wed")];
    expect(sortHoursByDay(rows).map((r) => r.day_type)).toEqual(["mon", "wed", "sun", "holiday"]);
  });

  it("동일 요일 다중 effective_from — 최신순 우선", () => {
    const rows = [mk("mon", "2026-01-01"), mk("mon", "2026-03-01"), mk("mon", "2026-02-01")];
    expect(sortHoursByDay(rows).map((r) => r.effective_from)).toEqual([
      "2026-03-01",
      "2026-02-01",
      "2026-01-01",
    ]);
  });
});

describe("formatKrw", () => {
  it("KRW 천 단위 콤마", () => {
    expect(formatKrw(0)).toBe("0원");
    expect(formatKrw(18000)).toBe("18,000원");
    expect(formatKrw(1_500_000)).toBe("1,500,000원");
  });

  it("비정상 입력은 -", () => {
    expect(formatKrw(NaN)).toBe("-");
    expect(formatKrw(-1)).toBe("-");
    expect(formatKrw(Infinity)).toBe("-");
  });
});

describe("formatTime", () => {
  it("HH:MM:SS → HH:MM", () => {
    expect(formatTime("10:00:00")).toBe("10:00");
    expect(formatTime("22:30:15")).toBe("22:30");
  });

  it("타임존 접미사 무시", () => {
    expect(formatTime("10:00:00+09")).toBe("10:00");
  });

  it("null 이면 빈 문자열", () => {
    expect(formatTime(null)).toBe("");
  });
});

// ============================================================
// 통합 테스트 — anon Supabase 클라이언트로 실제 클라우드 SELECT
// .env.local 이 로드되지 않는 vitest 환경이므로 env 가 있을 때만 실행
// ============================================================
describe("Supabase anon 통합 (클라우드)", () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const runIntegration = Boolean(url && key);

  it.skipIf(!runIntegration)("anon 으로 gyms SELECT — 활성 행만 (RLS read_active)", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url!, key!);
    const { data, error } = await supabase.from("gyms").select("id, slug, is_active").limit(5);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.is_active).toBe(true);
    }
  });

  it.skipIf(!runIntegration)("anon 으로 gym_branches SELECT — 활성 행만", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url!, key!);
    const { data, error } = await supabase
      .from("gym_branches")
      .select("id, slug, is_active")
      .limit(5);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.is_active).toBe(true);
    }
  });

  it.skipIf(!runIntegration)("anon 의 INSERT 는 RLS 로 차단되어야 함", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url!, key!);
    const { error } = await supabase
      .from("gyms")
      .insert({ slug: "anon-test", name_ko: "테스트", brand_type: "independent" });
    expect(error).not.toBeNull();
  });

  // HIGH-1 회귀 — 부모 gym 이 비활성이면 그 자식 branch 들이 anon SELECT 에 노출되지 않아야 한다.
  // 시드 데이터 환경에 의존하므로 기본은 skip. 검증 시 수동으로 활성/비활성 fixture 를 갖춘 뒤 실행.
  it.skip("부모 gym 비활성 시 자식 branch 가 anon SELECT 결과에 없어야 함", async () => {
    if (!runIntegration) return;
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url!, key!);
    // 부모 gym 의 is_active = false 인 행이 fixture 로 존재한다는 전제
    const { data: inactiveGyms, error: gErr } = await supabase
      .from("gyms")
      .select("id, is_active");
    expect(gErr).toBeNull();
    // anon 정책상 비활성 gym 은 조회 자체가 불가하므로 결과 행은 모두 active 여야 한다
    for (const g of inactiveGyms ?? []) expect(g.is_active).toBe(true);

    const { data: branches, error: bErr } = await supabase
      .from("gym_branches")
      .select("id, gym_id, is_active");
    expect(bErr).toBeNull();
    // 노출된 모든 branch 는 활성 + 부모도 활성이어야 한다.
    const activeGymIds = new Set((inactiveGyms ?? []).map((g) => g.id));
    for (const b of branches ?? []) {
      expect(b.is_active).toBe(true);
      expect(activeGymIds.has(b.gym_id)).toBe(true);
    }
  });
});
