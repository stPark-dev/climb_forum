import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticated } from "@/lib/server/auth-guard";
import { getGymWithBranches } from "@/lib/server/gyms";
import { FACILITY_TYPE_LABEL } from "@/lib/types/gyms";
import styles from "../gyms.module.css";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await getGymWithBranches(params.slug);
  if (!data) return { title: "클라이밍장 — climb_forum" };
  return {
    title: `${data.gym.name_ko} — 클라이밍장 — climb_forum`,
    description:
      data.gym.description ??
      `${data.gym.name_ko} 산하 지점 ${data.branches.length}곳의 위치·운영시간·가격 정보`,
  };
}

export default async function GymDetailPage({ params }: PageProps) {
  await requireAuthenticated(`/gyms/${params.slug}`);
  const data = await getGymWithBranches(params.slug);
  if (!data) notFound();

  const { gym, branches } = data;

  return (
    <main className={styles.page}>
      <p className={styles.crumb}>
        <Link href="/gyms">← 클라이밍장 목록</Link>
      </p>
      <header className={styles.header}>
        <h1 className={styles.title}>{gym.name_ko}</h1>
        {gym.name_en && <p className={styles.subtitle}>{gym.name_en}</p>}
        <p className={styles.subtitle}>
          {gym.brand_type === "chain" ? "체인 브랜드" : "독립 운영"} ·
          {" "}
          지점 {branches.length}곳
        </p>
        {gym.description && <p style={{ marginTop: "0.5rem" }}>{gym.description}</p>}
        {gym.website_url && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
            <a href={gym.website_url} target="_blank" rel="noopener noreferrer">
              공식 사이트 →
            </a>
          </p>
        )}
      </header>

      <section aria-label="지점 목록">
        <h2 className={styles.sectionTitle}>지점</h2>
        {branches.length === 0 ? (
          <div className={styles.empty}>
            <p>이 체인의 활성 지점이 아직 등록되지 않았습니다.</p>
          </div>
        ) : (
          <ul className={styles.grid} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {branches.map((b) => (
              <li key={b.id}>
                <Link href={`/gyms/${gym.slug}/${b.slug}`} className={styles.card}>
                  <p className={styles.cardBranchName}>{b.name_ko}</p>
                  <p className={styles.cardRegion}>
                    {b.region_sido} · {b.region_sgg}
                  </p>
                  <p className={styles.cardRegion}>{b.address}</p>
                  <div className={styles.cardChips}>
                    <span className={styles.badge}>
                      {FACILITY_TYPE_LABEL[b.facility_type]}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
