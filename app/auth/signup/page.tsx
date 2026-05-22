"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildOAuthRedirect, GOOGLE_SCOPE, sanitizeReturnTo } from "@/lib/supabase/auth-helpers";

export default function SignupPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextParam = sanitizeReturnTo(sp.get("next") ?? "/");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onEmailSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!agreed) {
      setError("이용약관·개인정보처리방침에 동의해야 가입할 수 있습니다.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    const emailRedirectTo = buildOAuthRedirect(siteUrl, nextParam);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });
    setLoading(false);
    if (error) {
      setError("회원가입 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    setInfo("입력하신 이메일로 인증 메일을 보냈습니다. 메일을 확인해주세요.");
  }

  async function onGoogleSignup() {
    setError(null);
    if (!agreed) {
      setError("이용약관·개인정보처리방침에 동의해야 가입할 수 있습니다.");
      return;
    }
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
      setError("구글 가입 중 오류가 발생했습니다.");
    }
  }

  return (
    <main className="container">
      <h1>회원가입</h1>
      <form onSubmit={onEmailSignup}>
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">비밀번호 (8자 이상)</label>
          <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span className="muted">
            <Link href="/terms" target="_blank">이용약관</Link>·
            <Link href="/privacy" target="_blank">개인정보처리방침</Link>에 동의합니다.
          </span>
        </label>
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "처리 중..." : "이메일로 가입"}
        </button>
        {error && <p className="err">{error}</p>}
        {info && <p className="muted" style={{ marginTop: "0.5rem" }}>{info}</p>}
      </form>

      <div className="divider">또는</div>

      <button className="btn btn-google" disabled={loading} onClick={onGoogleSignup} type="button" aria-label="구글로 가입">
        구글로 가입
      </button>

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        이미 계정이 있나요? <Link href={`/auth/login?next=${encodeURIComponent(nextParam)}`}>로그인</Link>
      </p>
    </main>
  );
}
