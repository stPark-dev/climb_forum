// 서버 전용 — 일반 로그인 가드 (role 검증 없음).
// admin 권한 가드는 lib/server/admin-auth.ts 사용.
// 동일 요청 안에서 Supabase 왕복 1회로 메모.

import * as React from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeReturnTo } from "@/lib/supabase/auth-helpers";

type CacheFn = <T extends (...args: never[]) => unknown>(fn: T) => T;
const cache: CacheFn =
  (React as unknown as { cache?: CacheFn }).cache ?? (((fn) => fn) as CacheFn);

export interface AuthUser {
  id: string;
  email: string | null;
}

const loadUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
});

/**
 * 비로그인이면 null, 로그인이면 user. UI 조건부 렌더용.
 * 강제 차단이 필요하면 requireAuthenticated 사용.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return loadUser();
}

/**
 * 비로그인 → /auth/login?next=<returnTo> 로 리다이렉트 (returnTo 는 sanitize 적용).
 * 로그인이면 user 반환.
 */
export async function requireAuthenticated(returnTo: string = "/"): Promise<AuthUser> {
  const user = await loadUser();
  if (!user) {
    const safe = sanitizeReturnTo(returnTo);
    redirect(`/auth/login?next=${encodeURIComponent(safe)}`);
  }
  return user;
}
