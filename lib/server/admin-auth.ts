// 서버 전용 — admin UI 권한 가드 유틸
// 모든 admin 페이지·서버 액션의 진입점에서 호출되어야 한다.
//
// 가드 3단계:
//   1) layout (app/admin/layout.tsx) — UI 진입점에서 1차
//   2) page (admin/.../page.tsx) — 페이지가 추가 role 제한이 있으면 2차
//   3) server function / action — 데이터 액세스 직전 3차 (방어적 중복)
// 3차까지 두는 이유는 RLS 가 anon 으로 동작하므로(즉, RLS 만으로 admin 권한 보장 X),
// 큐레이터/admin 만 호출해야 하는 서버 함수가 layout 우회 시도 시에도 안전하게 막힌다.
//
// 리다이렉트 경로 정책:
//   - 비로그인 → /auth/login?next=<returnTo>
//   - profile 없음 또는 role 부적합 → /403
//   - returnTo 는 호출자가 인자로 직접 전달 (headers() 의존 회피 — 테스트·SSR 단순화).
//     이유: page 가 자기 경로를 가장 잘 안다. headers() 는 동적이지만 미들웨어 헤더 의존성이
//     얹히면 테스트 환경 차이가 커진다. 단순한 쪽 선택.

import * as React from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type AppRole, isValidRole, sanitizeReturnTo } from "@/lib/supabase/auth-helpers";

// React 18 `cache` 는 React Server Components 컨텍스트(Next.js 빌드)에서만 정의된다.
// vitest 의 노드 환경에서는 undefined 이므로 identity 폴백 — 테스트에서는 메모이즈가 무의미하지만
// 동작 자체는 안전 (호출마다 새 호출).
type CacheFn = <T extends (...args: never[]) => unknown>(fn: T) => T;
const cache: CacheFn =
  (React as unknown as { cache?: CacheFn }).cache ?? (((fn) => fn) as CacheFn);

export interface AdminProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role_id: AppRole;
  is_banned: boolean;
}

export interface AdminUser {
  id: string;
  email: string | null;
}

export interface AdminContext {
  user: AdminUser;
  profile: AdminProfile;
}

// 내부 결과 — 비로그인, profile 없음, profile 있음 3 케이스 구분
type ProfileLookup =
  | { kind: "unauthenticated" }
  | { kind: "no-profile"; user: AdminUser }
  | { kind: "ok"; ctx: AdminContext };

// 동일 요청 라이프사이클에서 layout + page + server action 이 동시에 호출하더라도
// Supabase 왕복은 1회로 줄인다. React `cache()` 는 서버 컴포넌트 트리에서 안전.
const loadProfile = cache(async (): Promise<ProfileLookup> => {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "unauthenticated" };

  const adminUser: AdminUser = { id: user.id, email: user.email ?? null };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, role_id, is_banned")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[admin-auth] profile fetch failed", error);
    // RLS 또는 일시적 오류 — 차단 측 보수적 처리: profile 없음과 동일 분기
    return { kind: "no-profile", user: adminUser };
  }
  if (!data) return { kind: "no-profile", user: adminUser };

  const role: AppRole = isValidRole(data.role_id) ? data.role_id : "user";

  return {
    kind: "ok",
    ctx: {
      user: adminUser,
      profile: {
        id: data.id,
        username: data.username,
        display_name: data.display_name,
        avatar_url: data.avatar_url,
        role_id: role,
        is_banned: Boolean(data.is_banned),
      },
    },
  };
});

/**
 * 외부 노출용 — 가드 통과한 user/profile 컨텍스트 반환, 아니면 null.
 * 페이지/컴포넌트가 "로그인 여부만 가볍게 보고 싶을 때" 사용.
 * 가드가 필요하면 requireAdminAccess / requireRole 사용.
 */
export async function getCurrentProfile(): Promise<AdminContext | null> {
  const r = await loadProfile();
  return r.kind === "ok" ? r.ctx : null;
}

/**
 * 로그인 + profile 존재 + 미차단 만 검증. role 검증은 하지 않는다.
 * 비로그인 → /auth/login?next=<returnTo>
 * profile 부재·차단·기타 오류 → /403
 *
 * @param returnTo 로그인 후 돌아갈 안전한 상대 경로 (없으면 /admin)
 */
export async function requireAdminAccess(returnTo: string = "/admin"): Promise<AdminContext> {
  const r = await loadProfile();
  if (r.kind === "unauthenticated") {
    // returnTo 가 외부 URL·schema·//-prefixed 면 sanitize 가 "/" 로 강등 → open redirect 방어.
    // 현재 호출처는 모두 정적 문자열이지만 가드 함수는 입력을 신뢰하지 않는다.
    const safe = sanitizeReturnTo(returnTo);
    redirect(`/auth/login?next=${encodeURIComponent(safe)}`);
  }
  if (r.kind === "no-profile") redirect("/403");
  // banned 인 admin/curator 도 진입 차단 — 단일 admin 환경에서 자해 시 데드락.
  // 결정: ban 은 공정성 원칙상 role 무관하게 적용. 복구 경로는 DB 직접 UPDATE.
  // (다중 admin 운영이면 다른 admin 이 풀어줄 수 있음.)
  if (r.ctx.profile.is_banned) redirect("/403");
  return r.ctx;
}

/**
 * requireAdminAccess + role 화이트리스트 검증.
 * Step 1 의 모든 admin 페이지는 ['curator', 'admin'] 을 통과시킨다.
 */
export async function requireRole(
  allowedRoles: readonly AppRole[],
  returnTo: string = "/admin",
): Promise<AdminContext> {
  const ctx = await requireAdminAccess(returnTo);
  if (!allowedRoles.includes(ctx.profile.role_id)) redirect("/403");
  return ctx;
}
