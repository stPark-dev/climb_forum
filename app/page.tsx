import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="container home">
      <p className="home__eyebrow mono">CLIMB · FORUM · KR</p>
      <h1 className="home__title display">
        ClimbForum<span className="home__title-mark" aria-hidden="true">.</span>
      </h1>
      <p className="muted home__lede">
        대한민국 실내 클라이밍 포털 — 클라이밍장 정보 · 운영시간 · 가격
      </p>
      <p className="home__phase">
        <span className="neon-badge">Phase 1</span>
        <span className="muted home__phase-note">인증 부트스트랩</span>
      </p>
      {/* TODO(codex): hero — 클라이밍 홀드 잡는 손, 16:9, 다크톤 */}
      {user && (
        <section className="home__cta hero-cta">
          <h2 className="home__cta-title">지금 시작하기</h2>
          <ul className="home__cta-list">
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
      <div className="home__auth">
        {user ? (
          <>
            <p className="home__welcome">
              안녕하세요, <strong className="mono">{user.email ?? user.id}</strong>
            </p>
            <form action="/auth/signout" method="post">
              <button className="btn btn-secondary" type="submit">로그아웃</button>
            </form>
          </>
        ) : (
          <div className="home__auth-buttons">
            <Link className="btn btn-primary" href="/auth/login">로그인</Link>
            <Link className="btn btn-secondary" href="/auth/signup">회원가입</Link>
          </div>
        )}
      </div>
      <style>{`
        .home { max-width: 560px; padding: 2.5rem 2rem 3rem; }
        .home__eyebrow {
          margin: 0 0 0.5rem;
          font-size: 0.75rem;
          color: var(--cv-yellow, #d4ff00);
          letter-spacing: 0.18em;
          font-weight: 700;
        }
        .home__title {
          font-size: clamp(2.25rem, 5vw, 3.25rem);
          margin: 0 0 0.75rem;
          color: var(--text-primary);
        }
        .home__title-mark {
          color: var(--cv-yellow, #d4ff00);
        }
        .home__lede {
          font-size: 1rem;
          margin: 0 0 1rem;
        }
        .home__phase {
          margin: 0 0 1.75rem;
          display: inline-flex;
          align-items: center;
          gap: 0.625rem;
        }
        .home__phase-note { font-size: 0.8125rem; }

        .home__cta {
          margin-top: 1.75rem;
          padding-top: 1.5rem;
          border-top: 1px dashed var(--border-strong);
        }
        .home__cta-title {
          font-family: var(--font-display);
          font-size: 1.25rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          margin: 0 0 1rem;
        }
        .home__cta-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .home__auth { margin-top: 2rem; }
        .home__welcome {
          margin: 0 0 0.75rem;
          color: var(--text-secondary);
          font-size: 0.9375rem;
        }
        .home__welcome strong {
          color: var(--text-primary);
          font-size: 0.875rem;
        }
        .home__auth-buttons {
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
        }
      `}</style>
    </main>
  );
}
