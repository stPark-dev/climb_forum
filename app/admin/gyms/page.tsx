// admin 매장 목록 — SSR + searchParams 기반
// 비활성 매장도 표시. 체인명 + 지점명 동시 표기. status·sido·facility·q 필터.

import Link from "next/link";
import { listGymsForAdmin } from "@/lib/server/gyms";
import {
  ADMIN_GYM_STATUSES,
  FACILITY_TYPES,
  FACILITY_TYPE_LABEL,
  type AdminGymStatus,
  type FacilityType,
  parseListAdminGymsQuery,
} from "@/lib/types/gyms";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

const STATUS_LABEL: Record<AdminGymStatus, string> = {
  all: "전체",
  active: "운영 중",
  inactive: "비활성",
};

export default async function AdminGymsPage({ searchParams }: PageProps) {
  const input = parseListAdminGymsQuery(searchParams);
  // listGymsForAdmin 내부에서 3차 가드(requireRole) 호출
  const { items, total, page, pageSize } = await listGymsForAdmin(input);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="admin-gyms">
      <header className="admin-gyms__header">
        <h1 className="admin-gyms__title">매장 관리</h1>
        <p className="admin-gyms__subtitle">
          총 {total.toLocaleString("ko-KR")}곳 (현재 페이지 {page} / {totalPages})
        </p>
      </header>

      <form className="admin-gyms__filters" method="get" action="/admin/gyms">
        <label className="admin-gyms__field">
          <span className="admin-gyms__field-label">검색</span>
          <input
            type="search"
            name="q"
            defaultValue={input.q ?? ""}
            placeholder="지점명"
            className="admin-gyms__input"
            maxLength={100}
          />
        </label>
        <label className="admin-gyms__field">
          <span className="admin-gyms__field-label">시도</span>
          <input
            type="text"
            name="sido"
            defaultValue={input.sido ?? ""}
            placeholder="예: 서울"
            className="admin-gyms__input"
            maxLength={20}
          />
        </label>
        <label className="admin-gyms__field">
          <span className="admin-gyms__field-label">시설</span>
          <select
            name="facility"
            defaultValue={input.facility ?? ""}
            className="admin-gyms__select"
          >
            <option value="">전체</option>
            {FACILITY_TYPES.map((f) => (
              <option key={f} value={f}>
                {FACILITY_TYPE_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-gyms__field">
          <span className="admin-gyms__field-label">상태</span>
          <select name="status" defaultValue={input.status} className="admin-gyms__select">
            {ADMIN_GYM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="admin-gyms__submit">
          필터 적용
        </button>
      </form>

      {items.length === 0 ? (
        <p className="admin-gyms__empty">조건에 맞는 매장이 없습니다.</p>
      ) : (
        <table className="admin-gyms__table">
          <thead>
            <tr>
              <th scope="col">체인</th>
              <th scope="col">지점</th>
              <th scope="col">지역</th>
              <th scope="col">시설</th>
              <th scope="col">상태</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ gym, branch }) => (
              <tr
                key={branch.id}
                className="admin-gyms__row"
                data-active={branch.is_active ? "true" : "false"}
              >
                <td>{gym.name_ko}</td>
                <td>
                  <Link
                    href={`/gyms/${gym.slug}/${branch.slug}`}
                    className="admin-gyms__branch-link"
                  >
                    {branch.name_ko}
                  </Link>
                </td>
                <td>
                  {branch.region_sido} · {branch.region_sgg}
                </td>
                <td>{FACILITY_TYPE_LABEL[branch.facility_type]}</td>
                <td>
                  <span className="admin-gyms__status" data-status={branch.is_active ? "active" : "inactive"}>
                    {branch.is_active ? "운영 중" : "비활성"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <nav className="admin-gyms__pager" aria-label="페이지 이동">
          {page > 1 ? (
            <Link
              className="admin-gyms__pager-link"
              href={buildAdminGymsQuery({ ...input, page: page - 1 })}
              rel="prev"
            >
              이전
            </Link>
          ) : (
            <span className="admin-gyms__pager-disabled" aria-hidden="true">
              이전
            </span>
          )}
          <span className="admin-gyms__pager-info">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              className="admin-gyms__pager-link"
              href={buildAdminGymsQuery({ ...input, page: page + 1 })}
              rel="next"
            >
              다음
            </Link>
          ) : (
            <span className="admin-gyms__pager-disabled" aria-hidden="true">
              다음
            </span>
          )}
        </nav>
      )}
    </section>
  );
}

function buildAdminGymsQuery(params: {
  q?: string;
  sido?: string;
  facility?: FacilityType;
  status?: AdminGymStatus;
  page?: number;
}): string {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.sido) usp.set("sido", params.sido);
  if (params.facility) usp.set("facility", params.facility);
  if (params.status && params.status !== "all") usp.set("status", params.status);
  if (params.page && params.page > 1) usp.set("page", String(params.page));
  const qs = usp.toString();
  return qs ? `/admin/gyms?${qs}` : "/admin/gyms";
}
