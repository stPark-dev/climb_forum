// requireAdminAccess / requireRole 분기 검증
// Supabase server client 와 next/navigation 의 redirect 를 모킹.
// 실제 redirect 는 throw 이지만 본 테스트에서는 호출만 추적해도 충분.

import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock 들은 import 보다 먼저 평가되므로, hoist-safe 한 형태로 작성한다.
const redirectMock = vi.fn((_url: string) => {
  // 실제 next/navigation 의 redirect 는 NEXT_REDIRECT throw — 본 모킹은 호출 추적만.
  // 단, 호출 후 함수가 계속 실행되면 후속 로직이 잘못 평가되니 throw 로 흐름 끊기.
  throw new Error(`__redirect__:${_url}`);
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

// supabase server client 모킹 — auth.getUser, profiles select 결과를 케이스별로 주입
type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role_id: string;
  is_banned: boolean;
};

type MockState = {
  user: { id: string; email: string | null } | null;
  profile: ProfileRow | null;
  profileError: Error | null;
};

const state: MockState = {
  user: null,
  profile: null,
  profileError: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({
            data: state.profile,
            error: state.profileError,
          }),
        }),
      }),
    }),
  }),
}));

// React `cache()` 가 메모하므로 케이스마다 모듈 재로딩이 안전.
async function loadModule() {
  // 캐시 무효화 — vitest 에서 react cache 가 모듈 단위로 유지되는 문제 회피
  vi.resetModules();
  return await import("@/lib/server/admin-auth");
}

function reset() {
  redirectMock.mockClear();
  state.user = null;
  state.profile = null;
  state.profileError = null;
}

beforeEach(() => {
  reset();
});

describe("getCurrentProfile", () => {
  it("비로그인이면 null", async () => {
    state.user = null;
    const { getCurrentProfile } = await loadModule();
    expect(await getCurrentProfile()).toBeNull();
  });

  it("로그인 + profile 없음 → null", async () => {
    state.user = { id: "u1", email: "a@b.com" };
    state.profile = null;
    const { getCurrentProfile } = await loadModule();
    expect(await getCurrentProfile()).toBeNull();
  });

  it("로그인 + profile 있으면 user/profile 반환, role 정상", async () => {
    state.user = { id: "u1", email: "a@b.com" };
    state.profile = {
      id: "u1",
      username: "alice",
      display_name: "Alice",
      avatar_url: null,
      role_id: "curator",
      is_banned: false,
    };
    const { getCurrentProfile } = await loadModule();
    const ctx = await getCurrentProfile();
    expect(ctx?.user.id).toBe("u1");
    expect(ctx?.profile.role_id).toBe("curator");
    expect(ctx?.profile.username).toBe("alice");
  });

  it("알 수 없는 role 은 'user' 로 강등", async () => {
    state.user = { id: "u1", email: null };
    state.profile = {
      id: "u1",
      username: null,
      display_name: null,
      avatar_url: null,
      role_id: "superadmin",
      is_banned: false,
    };
    const { getCurrentProfile } = await loadModule();
    const ctx = await getCurrentProfile();
    expect(ctx?.profile.role_id).toBe("user");
  });

  it("profile fetch error 시 보수적으로 null (DB 장애 시 비로그인과 동일 취급 — 의도)", async () => {
    state.user = { id: "u1", email: null };
    state.profileError = new Error("db down");
    const { getCurrentProfile } = await loadModule();
    expect(await getCurrentProfile()).toBeNull();
  });
});

describe("requireAdminAccess", () => {
  it("비로그인 → /auth/login?next=... 로 redirect", async () => {
    state.user = null;
    const { requireAdminAccess } = await loadModule();
    await expect(requireAdminAccess("/admin/gyms")).rejects.toThrow("__redirect__:");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    const arg = redirectMock.mock.calls[0]?.[0] as string;
    expect(arg).toBe("/auth/login?next=%2Fadmin%2Fgyms");
  });

  it("기본 returnTo 는 /admin", async () => {
    state.user = null;
    const { requireAdminAccess } = await loadModule();
    await expect(requireAdminAccess()).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2Fadmin");
  });

  it("외부 URL returnTo 는 '/' 로 강등 (open redirect 방어)", async () => {
    state.user = null;
    const { requireAdminAccess } = await loadModule();
    await expect(requireAdminAccess("https://evil.com/path")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2F");
  });

  it("//-prefixed returnTo 도 '/' 로 강등", async () => {
    state.user = null;
    const { requireAdminAccess } = await loadModule();
    await expect(requireAdminAccess("//evil.com")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2F");
  });

  it("로그인 + profile 없음 → /403", async () => {
    state.user = { id: "u1", email: null };
    state.profile = null;
    const { requireAdminAccess } = await loadModule();
    await expect(requireAdminAccess()).rejects.toThrow("__redirect__:/403");
    expect(redirectMock).toHaveBeenCalledWith("/403");
  });

  it("로그인 + 차단된 profile → /403", async () => {
    state.user = { id: "u1", email: null };
    state.profile = {
      id: "u1",
      username: "banned",
      display_name: null,
      avatar_url: null,
      role_id: "user",
      is_banned: true,
    };
    const { requireAdminAccess } = await loadModule();
    await expect(requireAdminAccess()).rejects.toThrow("__redirect__:/403");
    expect(redirectMock).toHaveBeenCalledWith("/403");
  });

  it("로그인 + curator → { user, profile } 반환, redirect 호출 없음", async () => {
    state.user = { id: "u1", email: "a@b.com" };
    state.profile = {
      id: "u1",
      username: "curator1",
      display_name: "Curator",
      avatar_url: null,
      role_id: "curator",
      is_banned: false,
    };
    const { requireAdminAccess } = await loadModule();
    const ctx = await requireAdminAccess();
    expect(ctx.user.id).toBe("u1");
    expect(ctx.profile.role_id).toBe("curator");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("로그인 + role='user' → /403 (curator/admin 화이트리스트)", async () => {
    state.user = { id: "u1", email: null };
    state.profile = {
      id: "u1",
      username: "normal",
      display_name: null,
      avatar_url: null,
      role_id: "user",
      is_banned: false,
    };
    const { requireRole } = await loadModule();
    await expect(requireRole(["curator", "admin"])).rejects.toThrow("__redirect__:/403");
    expect(redirectMock).toHaveBeenCalledWith("/403");
  });

  it("로그인 + role='curator' → 통과", async () => {
    state.user = { id: "u1", email: null };
    state.profile = {
      id: "u1",
      username: "c",
      display_name: null,
      avatar_url: null,
      role_id: "curator",
      is_banned: false,
    };
    const { requireRole } = await loadModule();
    const ctx = await requireRole(["curator", "admin"]);
    expect(ctx.profile.role_id).toBe("curator");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("로그인 + role='admin' → 통과", async () => {
    state.user = { id: "u1", email: null };
    state.profile = {
      id: "u1",
      username: "a",
      display_name: null,
      avatar_url: null,
      role_id: "admin",
      is_banned: false,
    };
    const { requireRole } = await loadModule();
    const ctx = await requireRole(["curator", "admin"]);
    expect(ctx.profile.role_id).toBe("admin");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("requireRole(['admin']) + curator → /403", async () => {
    state.user = { id: "u1", email: null };
    state.profile = {
      id: "u1",
      username: "c",
      display_name: null,
      avatar_url: null,
      role_id: "curator",
      is_banned: false,
    };
    const { requireRole } = await loadModule();
    await expect(requireRole(["admin"])).rejects.toThrow("__redirect__:/403");
    expect(redirectMock).toHaveBeenCalledWith("/403");
  });

  it("비로그인 + requireRole → /auth/login (profile 검사 전 단계)", async () => {
    state.user = null;
    const { requireRole } = await loadModule();
    await expect(requireRole(["admin"], "/admin/gyms")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2Fadmin%2Fgyms");
  });
});
