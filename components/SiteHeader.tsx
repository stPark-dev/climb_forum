import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import styles from "./SiteHeader.module.css";

export default async function SiteHeader() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="주요 메뉴">
        <Link href="/" className={styles.brand}>ClimbForum</Link>
        <ul className={styles.menu}>
          {user && <li><Link href="/gyms">클라이밍장</Link></li>}
          {/* 추후: <li><Link href="/community">커뮤니티</Link></li> */}
          {/* 추후: <li><Link href="/tips">꿀팁</Link></li> */}
        </ul>
        <div className={styles.auth}>
          {user ? (
            <>
              <span className={styles.email} aria-label="로그인 계정">{user.email ?? user.id.slice(0, 8)}</span>
              <form action="/auth/signout" method="post">
                <button type="submit" className={styles.signoutBtn}>로그아웃</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/auth/login" className={styles.loginLink}>로그인</Link>
              <Link href="/auth/signup" className={styles.signupLink}>회원가입</Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
