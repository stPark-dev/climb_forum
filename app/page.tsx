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
      {user && (
        <section className="hero-cta" style={{ marginTop: "2rem" }}>
          <h2>지금 시작하기</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <li>
              <Link href="/gyms" className="card">
                <h3>클라이밍장 찾기</h3>
                <p className="muted">전국 실내 클라이밍장 정보와 지도</p>
              </Link>
            </li>
            {/* 추후 커뮤니티·꿀팁 카드 자리 */}
          </ul>
        </section>
      )}
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
