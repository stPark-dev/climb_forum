"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildOAuthRedirect, GOOGLE_SCOPE, sanitizeReturnTo } from "@/lib/supabase/auth-helpers";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextParam = sanitizeReturnTo(sp.get("next") ?? "/");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      // email enumeration 방어 — 통일 메시지
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    router.replace(nextParam);
    router.refresh();
  }

  async function onGoogleLogin() {
    setError(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    const redirectTo = buildOAuthRedirect(siteUrl, nextParam);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: GOOGLE_SCOPE,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      setLoading(false);
      setError("구글 로그인 중 오류가 발생했습니다.");
    }
  }

  return (
    <main className="container">
      <h1>로그인</h1>
      <form onSubmit={onEmailLogin}>
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "처리 중..." : "이메일로 로그인"}
        </button>
        {error && <p className="err">{error}</p>}
      </form>

      <div className="divider">또는</div>

      <button className="btn btn-google" disabled={loading} onClick={onGoogleLogin} type="button" aria-label="구글로 로그인">
        구글로 로그인
      </button>

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        계정이 없으신가요? <Link href={`/auth/signup?next=${encodeURIComponent(nextParam)}`}>회원가입</Link>
      </p>
    </main>
  );
}
