import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeReturnTo } from "@/lib/supabase/auth-helpers";

// OAuth + 이메일 매직링크 콜백.
// 쿼리 파라미터:
//   code  — Supabase가 발급한 인가 코드 (PKCE)
//   next  — 로그인 후 이동할 경로 (open redirect 방어 적용)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = sanitizeReturnTo(url.searchParams.get("next") ?? "/");
  const origin = url.origin;

  if (code) {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=callback`);
}
