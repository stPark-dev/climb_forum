import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import NaverMap from "@/components/NaverMap";
import { getBranchDetail } from "@/lib/server/gyms";
import {
  DAY_TYPES,
  DAY_TYPE_LABEL,
  FACILITY_TYPE_LABEL,
  PRICING_TYPE_LABEL,
  formatKrw,
  formatTime,
} from "@/lib/types/gyms";
import styles from "../../gyms.module.css";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string; branchSlug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await getBranchDetail(params.slug, params.branchSlug);
  if (!data) return { title: "클라이밍장 — climb_forum" };
  return {
    title: `${data.gym.name_ko} ${data.branch.name_ko} — climb_forum`,
    description: `${data.branch.region_sido} ${data.branch.region_sgg} · ${data.branch.address}`,
  };
}

export default async function BranchDetailPage({ params }: PageProps) {
  const data = await getBranchDetail(params.slug, params.branchSlug);

  if (!data) notFound();

  const { gym, branch, hours, pricing } = data;

  // 요일별 시간 매핑 (가장 최신 effective_from 기준으로 한 줄씩)
  // 미래에 적용 예정인(effective_from > today) 행은 제외 — 현재 운영시간만 표시
  const today = new Date().toISOString().slice(0, 10);
  const hoursByDay = new Map<string, (typeof hours)[number]>();
  for (const h of hours) {
    if (h.effective_from > today) continue;
    if (!hoursByDay.has(h.day_type)) hoursByDay.set(h.day_type, h);
  }

  return (
    <main className={styles.page}>
      <p className={styles.crumb}>
        <Link href="/gyms">← 클라이밍장</Link>
        {" / "}
        <Link href={`/gyms/${gym.slug}`}>{gym.name_ko}</Link>
      </p>

      <header className={styles.header}>
        <h1 className={styles.title}>
          {gym.name_ko} · {branch.name_ko}
        </h1>
        <p className={styles.subtitle}>
          {branch.region_sido} {branch.region_sgg}
        </p>
        <p className={styles.subtitle}>
          {branch.address}
          {branch.address_detail ? ` ${branch.address_detail}` : ""}
        </p>
      </header>

      <div className={styles.detailGrid}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <section className={styles.section} aria-label="기본 정보">
            <h2 className={styles.sectionTitle}>기본 정보</h2>
            <dl className={styles.kv}>
              <dt className={styles.kvLabel}>시설</dt>
              <dd>{FACILITY_TYPE_LABEL[branch.facility_type]}</dd>
              <dt className={styles.kvLabel}>전화</dt>
              <dd>
                {branch.phone ? (
                  <a href={`tel:${branch.phone.replace(/\s+/g, "")}`}>{branch.phone}</a>
                ) : (
                  <span aria-label="전화번호 미등록">-</span>
                )}
              </dd>
              <dt className={styles.kvLabel}>주소</dt>
              <dd>
                {branch.address}
                {branch.address_detail ? ` ${branch.address_detail}` : ""}
                {branch.postal_code ? ` (${branch.postal_code})` : ""}
              </dd>
              {gym.website_url && (
                <>
                  <dt className={styles.kvLabel}>웹사이트</dt>
                  <dd>
                    <a href={gym.website_url} target="_blank" rel="noopener noreferrer">
                      공식 사이트 →
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section className={styles.section} aria-label="운영시간">
            <h2 className={styles.sectionTitle}>운영시간</h2>
            {hoursByDay.size === 0 ? (
              <p style={{ color: "var(--text-secondary)" }}>운영시간 정보가 등록되지 않았습니다.</p>
            ) : (
              <table className={styles.table}>
                <caption className="sr-only" style={{ position: "absolute", left: "-9999px" }}>
                  요일별 운영시간
                </caption>
                <tbody>
                  {DAY_TYPES.map((day) => {
                    const h = hoursByDay.get(day);
                    if (!h) {
                      return (
                        <tr key={day}>
                          <th scope="row">{DAY_TYPE_LABEL[day]}</th>
                          <td style={{ color: "var(--text-secondary)" }}>-</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={day}>
                        <th scope="row">{DAY_TYPE_LABEL[day]}</th>
                        <td>
                          {h.is_closed ? (
                            <span>휴무</span>
                          ) : (
                            <span>
                              {formatTime(h.open_time)} – {formatTime(h.close_time)}
                            </span>
                          )}
                          {h.note && (
                            <span
                              style={{ marginLeft: "0.5rem", color: "var(--text-secondary)", fontSize: "0.8125rem" }}
                            >
                              {h.note}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className={styles.section} aria-label="가격">
            <h2 className={styles.sectionTitle}>가격</h2>
            {pricing.length === 0 ? (
              <p style={{ color: "var(--text-secondary)" }}>가격 정보가 등록되지 않았습니다.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">종류</th>
                    <th scope="col">상품</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      가격
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.map((p) => (
                    <tr key={p.id}>
                      <td style={{ color: "var(--text-secondary)" }}>
                        {PRICING_TYPE_LABEL[p.pricing_type]}
                      </td>
                      <td>
                        {p.label_ko}
                        {p.note && (
                          <span
                            style={{ marginLeft: "0.5rem", color: "var(--text-secondary)", fontSize: "0.8125rem" }}
                          >
                            {p.note}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatKrw(p.price_krw)}
                        {p.unit ? ` / ${p.unit}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <section className={styles.section} aria-label="지도">
            <h2 className={styles.sectionTitle}>위치</h2>
            <NaverMap
              lat={Number(branch.lat)}
              lng={Number(branch.lng)}
              name={`${gym.name_ko} ${branch.name_ko}`}
              height={320}
            />
            <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
              위도 {Number(branch.lat).toFixed(5)} · 경도 {Number(branch.lng).toFixed(5)}
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
