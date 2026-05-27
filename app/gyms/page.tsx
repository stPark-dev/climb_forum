import type { Metadata } from "next";
import Link from "next/link";
import { listGyms } from "@/lib/server/gyms";
import {
  FACILITY_TYPES,
  FACILITY_TYPE_LABEL,
  type FacilityType,
  parseListGymsQuery,
} from "@/lib/types/gyms";
import styles from "./gyms.module.css";

export const metadata: Metadata = {
  title: "클라이밍장 — climb_forum",
  description: "대한민국 실내 클라이밍장 지점 목록 · 지역·시설 필터 · 운영시간·요금 정보",
};

// 페이지가 쿼리에 따라 매번 다르므로 SSR 강제 (캐시 X)
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function GymsListPage({ searchParams }: PageProps) {
  const input = parseListGymsQuery(searchParams);
  const { items, total, page, pageSize } = await listGyms(input);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>클라이밍장</h1>
        <p className={styles.subtitle}>
          전국 실내 클라이밍장 지점 정보 · 운영시간 · 가격
          {total > 0 ? ` · 총 ${total.toLocaleString("ko-KR")}곳` : ""}
        </p>
      </header>

      <section className={styles.filterBar} aria-label="필터">
        <span className={styles.filterLabel}>시설</span>
        <FacilityFilterLinks current={input.facility} sido={input.sido} />
        {input.sido && (
          <>
            <span className={styles.filterLabel} style={{ marginLeft: "0.75rem" }}>
              지역
            </span>
            <span className={`${styles.chip} ${styles.chipActive}`}>
              {input.sido}
              <Link
                href={buildQuery({ facility: input.facility })}
                aria-label={`지역 필터 '${input.sido}' 제거`}
                className={styles.chipRemove}
              >
                <span aria-hidden="true">×</span>
              </Link>
            </span>
          </>
        )}
      </section>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>아직 등록된 클라이밍장이 없습니다</h2>
          <p>곧 업데이트 예정입니다. 운영자가 지점을 등록하는 대로 표시됩니다.</p>
        </div>
      ) : (
        <section aria-label="지점 목록">
          <ul
            className={styles.grid}
            style={{ listStyle: "none", padding: 0, margin: 0 }}
          >
            {items.map(({ gym, branch }) => {
              if (!branch) return null;
              return (
                <li key={branch.id}>
                  <Link
                    href={`/gyms/${gym.slug}/${branch.slug}`}
                    className={styles.card}
                  >
                    <div className={styles.cardTop}>
                      <p className={styles.cardGymName}>{gym.name_ko}</p>
                      {gym.brand_type === "chain" && (
                        <span className={styles.badge}>체인</span>
                      )}
                    </div>
                    <p className={styles.cardBranchName}>{branch.name_ko}</p>
                    <p className={styles.cardRegion}>
                      {branch.region_sido} · {branch.region_sgg}
                    </p>
                    <div className={styles.cardChips}>
                      <span className={styles.badge}>
                        {FACILITY_TYPE_LABEL[branch.facility_type]}
                      </span>
                      {branch.is_active && (
                        <span className={`${styles.badge} ${styles.badgeActive}`}>운영 중</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <nav className={styles.pager} aria-label="페이지 이동">
              {page > 1 ? (
                <Link
                  className={styles.pagerLink}
                  href={buildQuery({
                    sido: input.sido,
                    facility: input.facility,
                    page: page - 1,
                  })}
                  rel="prev"
                >
                  이전
                </Link>
              ) : (
                <span className={styles.pagerDisabled} aria-hidden="true">
                  이전
                </span>
              )}
              <span>
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  className={styles.pagerLink}
                  href={buildQuery({
                    sido: input.sido,
                    facility: input.facility,
                    page: page + 1,
                  })}
                  rel="next"
                >
                  다음
                </Link>
              ) : (
                <span className={styles.pagerDisabled} aria-hidden="true">
                  다음
                </span>
              )}
            </nav>
          )}
        </section>
      )}
    </main>
  );
}

function FacilityFilterLinks({
  current,
  sido,
}: {
  current: FacilityType | undefined;
  sido: string | undefined;
}) {
  return (
    <>
      <Link
        href={buildQuery({ sido })}
        className={`${styles.chip} ${current === undefined ? styles.chipActive : ""}`}
        aria-current={current === undefined ? "true" : undefined}
      >
        전체
      </Link>
      {FACILITY_TYPES.map((f) => (
        <Link
          key={f}
          href={buildQuery({ sido, facility: f })}
          className={`${styles.chip} ${current === f ? styles.chipActive : ""}`}
          aria-current={current === f ? "true" : undefined}
        >
          {FACILITY_TYPE_LABEL[f]}
        </Link>
      ))}
    </>
  );
}

function buildQuery(params: {
  sido?: string;
  facility?: FacilityType;
  page?: number;
}): string {
  const usp = new URLSearchParams();
  if (params.sido) usp.set("sido", params.sido);
  if (params.facility) usp.set("facility", params.facility);
  if (params.page && params.page > 1) usp.set("page", String(params.page));
  const qs = usp.toString();
  return qs ? `/gyms?${qs}` : "/gyms";
}
