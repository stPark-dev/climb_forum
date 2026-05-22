// 순수 함수 — 클라이언트/서버 모두 사용 가능, 테스트하기 쉽게 분리
// 구글은 OIDC. 최소 권한만 요청 (openid email profile).
export const GOOGLE_SCOPE = "openid email profile";

export function buildOAuthRedirect(siteUrl: string, returnTo: string = "/"): string {
  const base = stripTrailingSlash(siteUrl);
  const safe = sanitizeReturnTo(returnTo);
  return `${base}/auth/callback?next=${encodeURIComponent(safe)}`;
}

export function sanitizeReturnTo(input: string): string {
  if (!input || typeof input !== "string") return "/";
  // open redirect 방지: 절대 URL·프로토콜·schema 차단
  if (input.startsWith("//") || /^[a-z][a-z0-9+\-.]*:/i.test(input)) return "/";
  if (!input.startsWith("/")) return "/";
  return input;
}

export function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export const VALID_ROLES = ["user", "curator", "moderator", "admin"] as const;
export type AppRole = (typeof VALID_ROLES)[number];

export function isValidRole(value: unknown): value is AppRole {
  return typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value);
}
