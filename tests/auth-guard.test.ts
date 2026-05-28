// auth-guard.ts — 일반 로그인 가드 분기 검증
// admin-auth.test.ts 와 동일한 패턴: Supabase server client + next/navigation redirect 모킹.

import { describe, it, expect, beforeEach, vi } from "vitest";

const redirectMock = vi.fn((_url: string) => {
  throw new Error(`__redirect__:${_url}`);
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

type MockState = {
  user: { id: string; email: string | null } | null;
};

const state: MockState = { user: null };

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
  }),
}));

async function loadModule() {
  vi.resetModules();
  return await import("@/lib/server/auth-guard");
}

function reset() {
  redirectMock.mockClear();
  state.user = null;
}

beforeEach(() => {
  reset();
});

describe("getCurrentUser", () => {
  it("비로그인이면 null", async () => {
    state.user = null;
    const { getCurrentUser } = await loadModule();
    expect(await getCurrentUser()).toBeNull();
  });

  it("로그인이면 user 반환 (email 정상)", async () => {
    state.user = { id: "u1", email: "a@b.com" };
    const { getCurrentUser } = await loadModule();
    const u = await getCurrentUser();
    expect(u?.id).toBe("u1");
    expect(u?.email).toBe("a@b.com");
  });

  it("email 없는 user (OAuth provider 변종) — email null 로", async () => {
    state.user = { id: "u1", email: null };
    const { getCurrentUser } = await loadModule();
    const u = await getCurrentUser();
    expect(u?.id).toBe("u1");
    expect(u?.email).toBeNull();
  });
});

describe("requireAuthenticated", () => {
  it("비로그인 → /auth/login?next=<returnTo> redirect", async () => {
    state.user = null;
    const { requireAuthenticated } = await loadModule();
    await expect(requireAuthenticated("/gyms")).rejects.toThrow("__redirect__:");
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2Fgyms");
  });

  it("기본 returnTo 는 '/'", async () => {
    state.user = null;
    const { requireAuthenticated } = await loadModule();
    await expect(requireAuthenticated()).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2F");
  });

  it("외부 URL returnTo → '/' 로 강등 (open redirect 방어)", async () => {
    state.user = null;
    const { requireAuthenticated } = await loadModule();
    await expect(requireAuthenticated("https://evil.com/x")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2F");
  });

  it("//-prefixed returnTo → '/' 로 강등", async () => {
    state.user = null;
    const { requireAuthenticated } = await loadModule();
    await expect(requireAuthenticated("//evil.com")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?next=%2F");
  });

  it("returnTo 에 슬러그 포함된 정상 경로 통과 (urlencode 됨)", async () => {
    state.user = null;
    const { requireAuthenticated } = await loadModule();
    await expect(requireAuthenticated("/gyms/some-slug/branch-a")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith(
      "/auth/login?next=%2Fgyms%2Fsome-slug%2Fbranch-a",
    );
  });

  it("로그인 → user 반환, redirect 호출 없음", async () => {
    state.user = { id: "u1", email: "a@b.com" };
    const { requireAuthenticated } = await loadModule();
    const u = await requireAuthenticated("/gyms");
    expect(u.id).toBe("u1");
    expect(u.email).toBe("a@b.com");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
