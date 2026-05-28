// admin UI shell — 헤더(사용자·로그아웃) + 좌측 nav + 본문
// 시각 디자인은 자이가 별도 처리. 본 파일은 안정적 DOM 구조와 클래스명만 제공한다.
//
// 클래스명 컨벤션 (BEM-ish, 자이가 그대로 CSS 모듈 또는 글로벌 CSS 매핑하면 됨):
//   .admin-shell
//   .admin-shell__header
//   .admin-shell__brand
//   .admin-shell__user
//   .admin-shell__user-name
//   .admin-shell__user-role
//   .admin-shell__signout
//   .admin-shell__body
//   .admin-shell__sidebar
//   .admin-shell__main
//   .admin-nav, .admin-nav__list, .admin-nav__item, .admin-nav__link  (admin-nav.tsx)

import Link from "next/link";
import AdminNav from "./admin-nav";
import type { AdminContext } from "@/lib/server/admin-auth";

const ROLE_LABEL: Record<string, string> = {
  user: "일반",
  curator: "큐레이터",
  moderator: "모더레이터",
  admin: "관리자",
};

export interface AdminShellProps {
  user: AdminContext["user"];
  profile: AdminContext["profile"];
  children: React.ReactNode;
}

export default function AdminShell({ user, profile, children }: AdminShellProps) {
  const displayName = profile.display_name || profile.username || user.email || "사용자";
  const roleLabel = ROLE_LABEL[profile.role_id] ?? profile.role_id;

  return (
    <div className="admin-shell">
      <header className="admin-shell__header">
        <Link href="/admin" className="admin-shell__brand">
          climb_forum 관리자
        </Link>
        <div className="admin-shell__user">
          <span className="admin-shell__user-name">{displayName}</span>
          <span className="admin-shell__user-role" data-role={profile.role_id}>
            {roleLabel}
          </span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="admin-shell__signout">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <div className="admin-shell__body">
        <aside className="admin-shell__sidebar">
          <AdminNav />
        </aside>
        <main className="admin-shell__main">{children}</main>
      </div>
    </div>
  );
}
