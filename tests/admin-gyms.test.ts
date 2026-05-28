// listGymsForAdmin / listAdminGymsInputSchema 검증
// Supabase client 와 requireRole 을 모킹하고 쿼리 빌더 호출을 추적.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- next/navigation redirect 모킹 (admin-auth 가 사용) ----
const redirectMock = vi.fn((url: string) => {
  throw new Error(`__redirect__:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

// ---- Supabase server client 모킹 ----
// query builder 의 메서드 체이닝을 추적하기 위해 모든 메서드가 self 를 반환하는 프록시 사용.
// 마지막 await 시점에 { data, count, error } 반환.

type QueryCall = { method: string; args: unknown[] };

type MockProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role_id: string;
  is_banned: boolean;
};

interface MockState {
  user: { id: string; email: string | null } | null;
  profile: MockProfile | null;
  branchData: unknown[];
  branchCount: number;
  calls: QueryCall[];
}

const state: MockState = {
  user: null,
  profile: null,
  branchData: [],
  branchCount: 0,
  calls: [],
};

// PostgrestBuilder 흉내 — thenable 로 await 시 데이터 반환.
function buildQuery(table: string) {
  const record = (method: string, args: unknown[]) => {
    state.calls.push({ method: `${table}.${method}`, args });
  };
  const builder: Record<string, unknown> = {};
  const passthrough = (method: string) =>
    function (this: unknown, ...args: unknown[]) {
      record(method, args);
      return builder;
    };
  for (const m of ["select", "eq", "ilike", "order", "range", "in"]) {
    builder[m] = passthrough(m);
  }
  // thenable — await 가능
  (builder as { then: unknown }).then = (
    resolve: (v: { data: unknown[]; count: number; error: null }) => void,
  ) => resolve({ data: state.branchData, count: state.branchCount, error: null });
  // maybeSingle (profiles 조회용)
  (builder as { maybeSingle: () => Promise<unknown> }).maybeSingle = async () => ({
    data: state.profile,
    error: null,
  });
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => buildQuery(table),
  }),
}));

async function loadModule() {
  vi.resetModules();
  return await import("@/lib/server/gyms");
}

function reset() {
  redirectMock.mockClear();
  state.user = null;
  state.profile = null;
  state.branchData = [];
  state.branchCount = 0;
  state.calls = [];
}

beforeEach(() => {
  reset();
});

// 도우미 — admin user/profile 설정
function asAdmin() {
  state.user = { id: "u1", email: "admin@x" };
  state.profile = {
    id: "u1",
    username: "admin",
    display_name: "Admin",
    avatar_url: null,
    role_id: "admin",
    is_banned: false,
  };
}

function asCurator() {
  state.user = { id: "u2", email: null };
  state.profile = {
    id: "u2",
    username: "curator",
    display_name: null,
    avatar_url: null,
    role_id: "curator",
    is_banned: false,
  };
}

function asNormalUser() {
  state.user = { id: "u3", email: null };
  state.profile = {
    id: "u3",
    username: "user",
    display_name: null,
    avatar_url: null,
    role_id: "user",
    is_banned: false,
  };
}

// ============================================================
// zod 입력 스키마
// ============================================================
import {
  listAdminGymsInputSchema,
  parseListAdminGymsQuery,
} from "@/lib/types/gyms";

describe("listAdminGymsInputSchema", () => {
  it("기본값 — status='all', page=1, pageSize=20", () => {
    const r = listAdminGymsInputSchema.parse({});
    expect(r.status).toBe("all");
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
    expect(r.q).toBeUndefined();
  });

  it("status enum 검증", () => {
    expect(listAdminGymsInputSchema.safeParse({ status: "active" }).success).toBe(true);
    expect(listAdminGymsInputSchema.safeParse({ status: "inactive" }).success).toBe(true);
    expect(listAdminGymsInputSchema.safeParse({ status: "all" }).success).toBe(true);
    expect(listAdminGymsInputSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("q 길이 제한 — 1~100", () => {
    expect(listAdminGymsInputSchema.safeParse({ q: "" }).success).toBe(false);
    expect(listAdminGymsInputSchema.safeParse({ q: "a" }).success).toBe(true);
    expect(listAdminGymsInputSchema.safeParse({ q: "a".repeat(100) }).success).toBe(true);
    expect(listAdminGymsInputSchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
  });

  it("page/pageSize 경계", () => {
    expect(listAdminGymsInputSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listAdminGymsInputSchema.safeParse({ page: 1001 }).success).toBe(false);
    expect(listAdminGymsInputSchema.safeParse({ pageSize: 0 }).success).toBe(false);
    expect(listAdminGymsInputSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});

describe("parseListAdminGymsQuery", () => {
  it("URL 쿼리 정상 파싱", () => {
    const r = parseListAdminGymsQuery({
      q: "강남",
      sido: "서울",
      facility: "bouldering",
      status: "inactive",
      page: "2",
      pageSize: "10",
    });
    expect(r).toEqual({
      q: "강남",
      sido: "서울",
      facility: "bouldering",
      status: "inactive",
      page: 2,
      pageSize: 10,
    });
  });

  it("알 수 없는 status 는 'all' 로 강등", () => {
    expect(parseListAdminGymsQuery({ status: "weird" }).status).toBe("all");
    expect(parseListAdminGymsQuery({}).status).toBe("all");
  });

  it("빈 문자열은 undefined 로", () => {
    const r = parseListAdminGymsQuery({ q: "", sido: "", facility: "" });
    expect(r.q).toBeUndefined();
    expect(r.sido).toBeUndefined();
    expect(r.facility).toBeUndefined();
  });

  it("page NaN → 1", () => {
    expect(parseListAdminGymsQuery({ page: "abc" }).page).toBe(1);
  });

  it("page 음수 → 1 (5xx 회피)", () => {
    expect(parseListAdminGymsQuery({ page: "-5" }).page).toBe(1);
    expect(parseListAdminGymsQuery({ page: "0" }).page).toBe(1);
  });

  it("page 초과 → 1", () => {
    expect(parseListAdminGymsQuery({ page: "9999" }).page).toBe(1);
  });

  it("pageSize 음수·0·초과 → 20", () => {
    expect(parseListAdminGymsQuery({ pageSize: "-1" }).pageSize).toBe(20);
    expect(parseListAdminGymsQuery({ pageSize: "0" }).pageSize).toBe(20);
    expect(parseListAdminGymsQuery({ pageSize: "9999" }).pageSize).toBe(20);
  });
});

// ============================================================
// listGymsForAdmin — 가드 + 쿼리 조립
// ============================================================
describe("listGymsForAdmin — 권한 가드 (3차)", () => {
  it("비로그인 → /auth/login redirect (throw)", async () => {
    state.user = null;
    const { listGymsForAdmin } = await loadModule();
    await expect(listGymsForAdmin({})).rejects.toThrow("__redirect__:/auth/login");
  });

  it("로그인 + role='user' → /403 redirect", async () => {
    asNormalUser();
    const { listGymsForAdmin } = await loadModule();
    await expect(listGymsForAdmin({})).rejects.toThrow("__redirect__:/403");
  });

  it("curator 는 통과", async () => {
    asCurator();
    const { listGymsForAdmin } = await loadModule();
    const r = await listGymsForAdmin({});
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("admin 도 통과", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    const r = await listGymsForAdmin({});
    expect(r.total).toBe(0);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("listGymsForAdmin — 쿼리 필터 조립", () => {
  it("status='all' (기본) — is_active 필터 없음", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({});
    // gym_branches.eq 호출 인자 중 is_active 가 없어야 함
    const eqCalls = state.calls.filter((c) => c.method === "gym_branches.eq");
    const isActiveCalls = eqCalls.filter((c) => c.args[0] === "is_active");
    expect(isActiveCalls).toHaveLength(0);
  });

  it("status='active' → is_active = true", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({ status: "active" });
    const eqCalls = state.calls.filter((c) => c.method === "gym_branches.eq");
    const isActive = eqCalls.find((c) => c.args[0] === "is_active");
    expect(isActive).toBeDefined();
    expect(isActive?.args[1]).toBe(true);
  });

  it("status='inactive' → is_active = false", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({ status: "inactive" });
    const eqCalls = state.calls.filter((c) => c.method === "gym_branches.eq");
    const isActive = eqCalls.find((c) => c.args[0] === "is_active");
    expect(isActive).toBeDefined();
    expect(isActive?.args[1]).toBe(false);
  });

  it("q 필터 — name_ko ilike '%q%'", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({ q: "강남" });
    const ilikeCalls = state.calls.filter((c) => c.method === "gym_branches.ilike");
    expect(ilikeCalls).toHaveLength(1);
    expect(ilikeCalls[0]?.args[0]).toBe("name_ko");
    expect(ilikeCalls[0]?.args[1]).toBe("%강남%");
  });

  it("q 에 % 또는 _ 가 포함되면 무력화", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({ q: "ab%c_d" });
    const ilikeCalls = state.calls.filter((c) => c.method === "gym_branches.ilike");
    expect(ilikeCalls).toHaveLength(1);
    // % 와 _ 가 공백으로 치환됨 (PostgREST 와일드카드 escape)
    expect(ilikeCalls[0]?.args[1]).toBe("%ab c d%");
  });

  it("q 에 백슬래시도 무력화 (\\% 이스케이프 인젝션 방어)", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({ q: "ab\\c" });
    const ilikeCalls = state.calls.filter((c) => c.method === "gym_branches.ilike");
    expect(ilikeCalls).toHaveLength(1);
    expect(ilikeCalls[0]?.args[1]).toBe("%ab c%");
  });

  it("sido / facility 필터 모두 적용", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({ sido: "서울", facility: "lead" });
    const eqCalls = state.calls.filter((c) => c.method === "gym_branches.eq");
    const sidoCall = eqCalls.find((c) => c.args[0] === "region_sido");
    const facilityCall = eqCalls.find((c) => c.args[0] === "facility_type");
    expect(sidoCall?.args[1]).toBe("서울");
    expect(facilityCall?.args[1]).toBe("lead");
  });

  it("페이지네이션 — range 계산", async () => {
    asAdmin();
    const { listGymsForAdmin } = await loadModule();
    await listGymsForAdmin({ page: 3, pageSize: 10 });
    const rangeCalls = state.calls.filter((c) => c.method === "gym_branches.range");
    expect(rangeCalls).toHaveLength(1);
    // page 3, pageSize 10 → from=20, to=29
    expect(rangeCalls[0]?.args).toEqual([20, 29]);
  });

  it("result.page / pageSize 는 입력 값으로 반환", async () => {
    asAdmin();
    state.branchCount = 42;
    const { listGymsForAdmin } = await loadModule();
    const r = await listGymsForAdmin({ page: 2, pageSize: 5 });
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(5);
    expect(r.total).toBe(42);
  });
});
