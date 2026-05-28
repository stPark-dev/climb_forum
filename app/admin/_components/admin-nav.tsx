// admin 좌측 네비게이션 — 서버 컴포넌트 (정적)
// 자이의 디자인 작업이 클래스명·DOM 구조를 그대로 사용할 수 있도록
// 의미가 명확한 className 만 노출. 인라인 스타일·기능 외 시각 강조는 최소화.

import Link from "next/link";

export interface AdminNavItem {
  href: string;
  label: string;
}

export const DEFAULT_ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/gyms", label: "매장" },
];

export interface AdminNavProps {
  items?: AdminNavItem[];
}

export default function AdminNav({ items = DEFAULT_ADMIN_NAV_ITEMS }: AdminNavProps) {
  return (
    <nav className="admin-nav" aria-label="관리자 메뉴">
      <ul className="admin-nav__list">
        {items.map((item) => (
          <li key={item.href} className="admin-nav__item">
            <Link href={item.href} className="admin-nav__link">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
