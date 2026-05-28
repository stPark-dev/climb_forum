// admin 영역 공통 레이아웃 — 1차 권한 가드 + AdminShell 래핑
// 큐레이터·admin 모두 admin UI 접근 허용. moderator 는 별도 영역에서 다룸.

import type { Metadata } from "next";
import { requireRole } from "@/lib/server/admin-auth";
import AdminShell from "./_components/admin-shell";
import "./_components/admin-shell.css";
import "./admin.css";

export const metadata: Metadata = {
  title: "Admin | climb_forum",
  // admin 페이지는 검색엔진 색인 금지
  robots: { index: false, follow: false },
};

// cookies()/auth 의존이라 SSR 강제 + 캐시 금지
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireRole(["curator", "admin"], "/admin");
  return (
    <AdminShell user={user} profile={profile}>
      {children}
    </AdminShell>
  );
}
