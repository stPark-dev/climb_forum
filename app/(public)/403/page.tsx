// 403 — 권한 없음 페이지
// admin/큐레이터 가드가 차단할 때 redirect 도착지.

import type { Metadata } from "next";
import Link from "next/link";
import "./forbidden.css";

export const metadata: Metadata = {
  title: "권한 없음 — climb_forum",
  robots: { index: false, follow: false },
};

export default function ForbiddenPage() {
  return (
    <main className="forbidden">
      <h1 className="forbidden__title">권한이 없습니다</h1>
      <p className="forbidden__message">
        이 페이지에 접근할 수 있는 권한이 없습니다. 관리자에게 문의하거나 다른 계정으로 로그인해 주세요.
      </p>
      <p>
        <Link href="/" className="forbidden__home">
          홈으로 돌아가기
        </Link>
      </p>
    </main>
  );
}
