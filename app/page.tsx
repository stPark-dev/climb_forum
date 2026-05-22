import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="container">
      <h1>ClimbForum</h1>
      <p className="muted">대한민국 실내 클라이밍 포털 (Phase 1 — 인증 부트스트랩)</p>
      {/* TODO(codex): hero — 클라이밍 홀드 잡는 손, 16:9, 다크톤 */}
      <div style={{ marginTop: "2rem" }}>
        {user ? (
          <>
            <p>안녕하세요, <strong>{user.email ?? user.id}</strong></p>
            <form action="/auth/signout" method="post">
              <button className="btn btn-secondary" type="submit">로그아웃</button>
            </form>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <Link className="btn btn-primary" href="/auth/login">로그인</Link>
            <Link className="btn btn-secondary" href="/auth/signup">회원가입</Link>
          </div>
        )}
      </div>
    </main>
  );
}
