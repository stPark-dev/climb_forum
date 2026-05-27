// gyms 도메인 — DB row 타입 + DTO + zod 입력 검증 스키마
// SQL 제약(20260526000001_gyms_domain.sql)과 동일한 규칙을 zod 로 반영해
// 서버에서 사용자/쿼리 입력을 1차 검증한다.

import { z } from "zod";

// ============================================================
// 1. 공통 enum
// ============================================================
export const BRAND_TYPES = ["chain", "independent"] as const;
export type BrandType = (typeof BRAND_TYPES)[number];

export const FACILITY_TYPES = ["bouldering", "lead", "both"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const DAY_TYPES = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const PRICING_TYPES = [
  "day_pass",
  "multi_pass",
  "monthly",
  "period",
  "rental",
  "other",
] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

// 한국어 라벨 (UI 표기용 — 색에 의존하지 않도록 글자도 함께)
export const DAY_TYPE_LABEL: Record<DayType, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
  holiday: "공휴일",
};

export const FACILITY_TYPE_LABEL: Record<FacilityType, string> = {
  bouldering: "볼더링",
  lead: "리드",
  both: "볼더링 · 리드",
};

export const PRICING_TYPE_LABEL: Record<PricingType, string> = {
  day_pass: "일일권",
  multi_pass: "다회권",
  monthly: "월권",
  period: "기간권",
  rental: "대여",
  other: "기타",
};

// ============================================================
// 2. 슬러그 검증 (SQL check 와 일치)
// ============================================================
// gyms.slug: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$  (총 3~64자)
// gym_branches.slug: ^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$  (총 3~82자)
export const gymSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "gym slug 형식이 올바르지 않습니다");
export const branchSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/, "branch slug 형식이 올바르지 않습니다");

// ============================================================
// 3. 좌표 / 지역 검증 (SQL check 와 일치)
// ============================================================
export const latSchema = z.number().min(33).max(39);
export const lngSchema = z.number().min(124).max(132);
export const sidoSchema = z.string().min(2).max(20);
export const sggSchema = z.string().min(2).max(30);

// ============================================================
// 4. 목록 쿼리 입력 — `?sido=서울&facility=bouldering&page=1`
// ============================================================
export const listGymsInputSchema = z.object({
  sido: sidoSchema.optional(),
  facility: z.enum(FACILITY_TYPES).optional(),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type ListGymsInput = z.infer<typeof listGymsInputSchema>;

// 자유 입력을 안전한 ListGymsInput 으로 정규화 (URL 쿼리에서 사용)
export function parseListGymsQuery(query: Record<string, string | string[] | undefined>): ListGymsInput {
  const pick = (key: string): string | undefined => {
    const v = query[key];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const pageNum = Number.parseInt(pick("page") ?? "1", 10);
  const pageSizeNum = Number.parseInt(pick("pageSize") ?? "20", 10);

  return listGymsInputSchema.parse({
    sido: pick("sido") || undefined,
    facility: pick("facility") || undefined,
    page: Number.isFinite(pageNum) ? pageNum : 1,
    pageSize: Number.isFinite(pageSizeNum) ? pageSizeNum : 20,
  });
}

// ============================================================
// 5. DB Row 타입 (Supabase 응답 모양과 1:1)
// ============================================================
export interface GymRow {
  id: string;
  slug: string;
  name_ko: string;
  name_en: string | null;
  brand_type: BrandType;
  website_url: string | null;
  description: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GymBranchRow {
  id: string;
  gym_id: string;
  slug: string;
  name_ko: string;
  region_sido: string;
  region_sgg: string;
  address: string;
  address_detail: string | null;
  postal_code: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  kakao_place_id: string | null;
  facility_type: FacilityType;
  is_active: boolean;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GymHourRow {
  id: string;
  branch_id: string;
  day_type: DayType;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
  note: string | null;
  effective_from: string;
}

export interface GymPricingRow {
  id: string;
  branch_id: string;
  pricing_type: PricingType;
  label_ko: string;
  price_krw: number;
  unit: string | null;
  note: string | null;
  effective_from: string | null;
  effective_until: string | null;
  sort_order: number;
}

// ============================================================
// 6. UI DTO — 목록·상세에서 필요한 형태로 정제
// ============================================================
/** 목록 카드 1장 — 체인 1행 + 대표 지점 1행 (또는 지점이 없으면 체인 정보만) */
export interface GymListCard {
  gym: Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "logo_url">;
  branch: Pick<
    GymBranchRow,
    "id" | "slug" | "name_ko" | "region_sido" | "region_sgg" | "facility_type" | "is_active"
  > | null;
}

export interface GymWithBranches {
  gym: GymRow;
  branches: GymBranchRow[];
}

export interface BranchDetail {
  gym: Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "website_url">;
  branch: GymBranchRow;
  hours: GymHourRow[];
  pricing: GymPricingRow[];
}

// ============================================================
// 7. 가격 정렬 (sort_order ASC, price_krw ASC, id ASC)
// ============================================================
export function sortPricing(rows: GymPricingRow[]): GymPricingRow[] {
  return [...rows].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if (a.price_krw !== b.price_krw) return a.price_krw - b.price_krw;
    return a.id.localeCompare(b.id);
  });
}

// ============================================================
// 8. 운영시간 — DAY_TYPES 순서로 정렬 (월→일→공휴일)
// ============================================================
export function sortHoursByDay(rows: GymHourRow[]): GymHourRow[] {
  const order = new Map<DayType, number>(DAY_TYPES.map((d, i) => [d, i]));
  return [...rows].sort((a, b) => {
    const ao = order.get(a.day_type) ?? 99;
    const bo = order.get(b.day_type) ?? 99;
    if (ao !== bo) return ao - bo;
    // 동일 요일에 effective_from 이 여러 개인 경우 최신순 우선
    return b.effective_from.localeCompare(a.effective_from);
  });
}

// ============================================================
// 9. 가격 포맷 (KRW)
// ============================================================
export function formatKrw(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "-";
  return `${amount.toLocaleString("ko-KR")}원`;
}

// HH:MM:SS → HH:MM
export function formatTime(t: string | null): string {
  if (!t) return "";
  // PostgREST 의 time 타입은 "HH:MM:SS" 또는 "HH:MM:SS+09" 등으로 올 수 있다
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}
