// admin 대시보드 — 매장/체인 카운트 카드
// 시각 디자인은 자이의 후속 작업. 본 파일은 안정적 DOM 구조만.

import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";

interface DashboardCounts {
  totalBranches: number | null;
  activeBranches: number | null;
  inactiveBranches: number | null;
  totalGyms: number | null;
}

async function loadCounts(): Promise<DashboardCounts> {
  // 3차 가드 — listGymsForAdmin 과 동일한 패턴. React cache 로 메모되어 page 의 가드와 비용 동일.
  await requireRole(["curator", "admin"]);
  const supabase = createSupabaseServerClient();

  const [totalRes, activeRes, inactiveRes, gymsRes] = await Promise.all([
    supabase.from("gym_branches").select("id", { head: true, count: "exact" }),
    supabase.from("gym_branches").select("id", { head: true, count: "exact" }).eq("is_active", true),
    supabase
      .from("gym_branches")
      .select("id", { head: true, count: "exact" })
      .eq("is_active", false),
    supabase.from("gyms").select("id", { head: true, count: "exact" }),
  ]);

  if (totalRes.error) console.error("[admin/dashboard] totalBranches", totalRes.error);
  if (activeRes.error) console.error("[admin/dashboard] activeBranches", activeRes.error);
  if (inactiveRes.error) console.error("[admin/dashboard] inactiveBranches", inactiveRes.error);
  if (gymsRes.error) console.error("[admin/dashboard] totalGyms", gymsRes.error);

  return {
    totalBranches: totalRes.count,
    activeBranches: activeRes.count,
    inactiveBranches: inactiveRes.count,
    totalGyms: gymsRes.count,
  };
}

function formatCount(n: number | null): string {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR");
}

export default async function AdminDashboardPage() {
  // 2차 가드 (layout 이 이미 통과시켰지만 방어적으로)
  await requireRole(["curator", "admin"], "/admin");
  const counts = await loadCounts();

  return (
    <section className="admin-dashboard">
      <header className="admin-dashboard__header">
        <h1 className="admin-dashboard__title">대시보드</h1>
        <p className="admin-dashboard__subtitle">매장 현황 요약</p>
      </header>

      <ul className="admin-dashboard__cards">
        <li className="admin-card">
          <p className="admin-card__label">전체 지점</p>
          <p className="admin-card__value">{formatCount(counts.totalBranches)}</p>
        </li>
        <li className="admin-card">
          <p className="admin-card__label">운영 중 지점</p>
          <p className="admin-card__value">{formatCount(counts.activeBranches)}</p>
        </li>
        <li className="admin-card">
          <p className="admin-card__label">비활성 지점</p>
          <p className="admin-card__value">{formatCount(counts.inactiveBranches)}</p>
        </li>
        <li className="admin-card">
          <p className="admin-card__label">체인 · 단독 매장</p>
          <p className="admin-card__value">{formatCount(counts.totalGyms)}</p>
        </li>
      </ul>

      <div className="admin-dashboard__actions">
        <Link href="/admin/gyms" className="admin-dashboard__link">
          매장 목록 보기
        </Link>
      </div>
    </section>
  );
}
