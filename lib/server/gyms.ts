// 서버 전용 — gyms 도메인 데이터 액세스
// Supabase ssr server client 를 통해 RLS 가 걸린 anon 권한으로 SELECT.
// 모든 함수는 RLS 의 read_active 정책 덕분에 is_active = true 인 행만 반환된다.
// 에러는 명확한 메시지로 throw 한다 (Next.js error boundary 가 처리).
// `cookies()` 의존성 때문에 클라이언트 컴포넌트에서 import 시 빌드 자체가 실패하므로
// 별도의 `server-only` import 없이도 안전.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/server/admin-auth";
import {
  type BranchDetail,
  type GymBranchRow,
  type GymHourRow,
  type GymListCard,
  type GymPricingRow,
  type GymRow,
  type GymWithBranches,
  type ListAdminGymsInput,
  type ListGymsInput,
  branchSlugSchema,
  gymSlugSchema,
  listAdminGymsInputSchema,
  listGymsInputSchema,
  sortHoursByDay,
  sortPricing,
} from "@/lib/types/gyms";

// ============================================================
// 1. listGyms — 활성 지점 카드 목록 (지점 기준, 체인 join)
// ============================================================
export interface ListGymsResult {
  items: GymListCard[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listGyms(input: Partial<ListGymsInput> = {}): Promise<ListGymsResult> {
  const parsed = listGymsInputSchema.parse({
    sido: input.sido,
    facility: input.facility,
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 20,
  });

  const supabase = createSupabaseServerClient();
  const from = (parsed.page - 1) * parsed.pageSize;
  const to = from + parsed.pageSize - 1;

  let query = supabase
    .from("gym_branches")
    .select(
      `
        id, slug, name_ko, region_sido, region_sgg, facility_type, is_active, gym_id,
        gym:gyms!inner ( id, slug, name_ko, name_en, brand_type, logo_url, is_active )
      `,
      { count: "exact" },
    )
    .eq("is_active", true)
    .eq("gym.is_active", true)
    .order("region_sido", { ascending: true })
    .order("name_ko", { ascending: true })
    .range(from, to);

  if (parsed.sido) query = query.eq("region_sido", parsed.sido);
  if (parsed.facility) query = query.eq("facility_type", parsed.facility);

  const { data, error, count } = await query;
  if (error) {
    console.error("[gyms] listGyms failed", error);
    throw new Error("클라이밍장 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  type Row = Pick<
    GymBranchRow,
    "id" | "slug" | "name_ko" | "region_sido" | "region_sgg" | "facility_type" | "is_active"
  > & {
    gym_id: string;
    // Supabase select with !inner 는 단일 객체가 정상이지만 타입은 array | object 양쪽으로 추론된다.
    gym:
      | Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "logo_url">
      | Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "logo_url">[];
  };

  const items: GymListCard[] = ((data as Row[] | null) ?? []).map((row) => {
    const gym = Array.isArray(row.gym) ? row.gym[0] : row.gym;
    return {
      gym: {
        id: gym.id,
        slug: gym.slug,
        name_ko: gym.name_ko,
        name_en: gym.name_en,
        brand_type: gym.brand_type,
        logo_url: gym.logo_url,
      },
      branch: {
        id: row.id,
        slug: row.slug,
        name_ko: row.name_ko,
        region_sido: row.region_sido,
        region_sgg: row.region_sgg,
        facility_type: row.facility_type,
        is_active: row.is_active,
      },
    };
  });

  return {
    items,
    total: count ?? items.length,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

// ============================================================
// 2. getGymWithBranches — 체인 1개 + 산하 활성 지점들
// ============================================================
export async function getGymWithBranches(slug: string): Promise<GymWithBranches | null> {
  // 슬러그 형식 검증 — 잘못된 입력은 DB 쿼리 전에 차단
  const parsedSlug = gymSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const supabase = createSupabaseServerClient();

  const { data: gym, error: gymErr } = await supabase
    .from("gyms")
    .select(
      "id, slug, name_ko, name_en, brand_type, website_url, description, logo_url, is_active, created_at, updated_at",
    )
    .eq("slug", parsedSlug.data)
    .eq("is_active", true)
    .maybeSingle();

  if (gymErr) {
    console.error("[gyms] getGymWithBranches gym fetch failed", gymErr);
    throw new Error("클라이밍장 정보를 불러오지 못했습니다.");
  }
  if (!gym) return null;

  const { data: branches, error: branchErr } = await supabase
    .from("gym_branches")
    .select("*")
    .eq("gym_id", gym.id)
    .eq("is_active", true)
    .order("region_sido", { ascending: true })
    .order("name_ko", { ascending: true });

  if (branchErr) {
    console.error("[gyms] getGymWithBranches branches fetch failed", branchErr);
    throw new Error("지점 목록을 불러오지 못했습니다.");
  }

  return {
    gym: gym as GymRow,
    branches: (branches ?? []) as GymBranchRow[],
  };
}

// ============================================================
// 3. getBranchDetail — 단일 지점 + 운영시간 + 가격
// 부모 체인 slug 도 함께 검증해 다른 체인의 branch 가 잠시라도 노출되지 않게 한다
// ============================================================
export async function getBranchDetail(
  gymSlug: string,
  branchSlug: string,
): Promise<BranchDetail | null> {
  const parsedGymSlug = gymSlugSchema.safeParse(gymSlug);
  if (!parsedGymSlug.success) return null;
  const parsedSlug = branchSlugSchema.safeParse(branchSlug);
  if (!parsedSlug.success) return null;

  const supabase = createSupabaseServerClient();

  const { data: branchRaw, error: bErr } = await supabase
    .from("gym_branches")
    .select(
      `
        *,
        gym:gyms!inner ( id, slug, name_ko, name_en, brand_type, website_url, is_active )
      `,
    )
    .eq("slug", parsedSlug.data)
    .eq("is_active", true)
    .eq("gym.slug", parsedGymSlug.data)
    .maybeSingle();

  if (bErr) {
    console.error("[gyms] getBranchDetail branch fetch failed", bErr);
    throw new Error("지점 정보를 불러오지 못했습니다.");
  }
  if (!branchRaw) return null;

  type BranchWithGym = GymBranchRow & {
    gym:
      | (Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "website_url"> & {
          is_active: boolean;
        })
      | (Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "website_url"> & {
          is_active: boolean;
        })[];
  };
  const row = branchRaw as BranchWithGym;
  const gym = Array.isArray(row.gym) ? row.gym[0] : row.gym;

  // 부모 체인이 비활성이면 노출 금지
  if (!gym || !gym.is_active) return null;

  const [{ data: hours, error: hErr }, { data: pricing, error: pErr }] = await Promise.all([
    supabase
      .from("gym_hours")
      .select("id, branch_id, day_type, open_time, close_time, is_closed, note, effective_from")
      .eq("branch_id", row.id),
    supabase
      .from("gym_pricing")
      .select(
        "id, branch_id, pricing_type, label_ko, price_krw, unit, note, effective_from, effective_until, sort_order",
      )
      .eq("branch_id", row.id),
  ]);

  if (hErr) {
    console.error("[gyms] getBranchDetail hours fetch failed", hErr);
    throw new Error("운영시간 정보를 불러오지 못했습니다.");
  }
  if (pErr) {
    console.error("[gyms] getBranchDetail pricing fetch failed", pErr);
    throw new Error("요금 정보를 불러오지 못했습니다.");
  }

  const { gym: _gym, ...branchOnly } = row;
  return {
    gym: {
      id: gym.id,
      slug: gym.slug,
      name_ko: gym.name_ko,
      name_en: gym.name_en,
      brand_type: gym.brand_type,
      website_url: gym.website_url,
    },
    branch: branchOnly as GymBranchRow,
    hours: sortHoursByDay((hours ?? []) as GymHourRow[]),
    pricing: sortPricing((pricing ?? []) as GymPricingRow[]),
  };
}

// ============================================================
// 4. listGymsForAdmin — admin UI 전용 매장 목록
// public listGyms 와 다른 점:
//   - is_active = true 강제하지 않음 (status=all/active/inactive 선택)
//   - q 키워드 검색 (gym_branches.name_ko ilike)
//   - 호출 직전 3차 가드 (requireRole) — RLS 우회 시도 방어
// ============================================================
export interface AdminGymRow {
  branch: Pick<
    GymBranchRow,
    | "id"
    | "slug"
    | "name_ko"
    | "region_sido"
    | "region_sgg"
    | "facility_type"
    | "is_active"
    | "closed_at"
    | "created_at"
    | "updated_at"
  >;
  gym: Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "is_active">;
}

export interface ListGymsForAdminResult {
  items: AdminGymRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listGymsForAdmin(
  input: Partial<ListAdminGymsInput> = {},
): Promise<ListGymsForAdminResult> {
  // 3차 가드 — layout/page 가드를 우회한 경로(서버 액션 등)에서도 안전.
  // 일반 회원이 직접 이 함수를 호출하면 /403 으로 리다이렉트된다.
  await requireRole(["curator", "admin"]);

  const parsed = listAdminGymsInputSchema.parse({
    q: input.q,
    sido: input.sido,
    facility: input.facility,
    status: input.status ?? "all",
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 20,
  });

  const supabase = createSupabaseServerClient();
  const from = (parsed.page - 1) * parsed.pageSize;
  const to = from + parsed.pageSize - 1;

  let query = supabase
    .from("gym_branches")
    .select(
      `
        id, slug, name_ko, region_sido, region_sgg, facility_type, is_active, closed_at, created_at, updated_at, gym_id,
        gym:gyms!inner ( id, slug, name_ko, name_en, brand_type, is_active )
      `,
      { count: "exact" },
    )
    .order("is_active", { ascending: false })
    .order("region_sido", { ascending: true })
    .order("name_ko", { ascending: true })
    .range(from, to);

  if (parsed.status === "active") query = query.eq("is_active", true);
  else if (parsed.status === "inactive") query = query.eq("is_active", false);
  // status === 'all' 인 경우는 필터 없음

  if (parsed.sido) query = query.eq("region_sido", parsed.sido);
  if (parsed.facility) query = query.eq("facility_type", parsed.facility);
  if (parsed.q) {
    // PostgREST ilike 와일드카드 escape — %, _, \ 모두 사용자 입력에서 제거.
    // 백슬래시도 막는 이유: \% 같은 이스케이프 시퀀스 인젝션·invalid escape 에러 방지.
    const safe = parsed.q.replace(/[\\%_]/g, " ").trim();
    if (safe.length > 0) query = query.ilike("name_ko", `%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[gyms] listGymsForAdmin failed", error);
    throw new Error("매장 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  type Row = Pick<
    GymBranchRow,
    | "id"
    | "slug"
    | "name_ko"
    | "region_sido"
    | "region_sgg"
    | "facility_type"
    | "is_active"
    | "closed_at"
    | "created_at"
    | "updated_at"
  > & {
    gym_id: string;
    gym:
      | Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "is_active">
      | Pick<GymRow, "id" | "slug" | "name_ko" | "name_en" | "brand_type" | "is_active">[];
  };

  const items: AdminGymRow[] = ((data as Row[] | null) ?? []).map((row) => {
    const gym = Array.isArray(row.gym) ? row.gym[0] : row.gym;
    return {
      branch: {
        id: row.id,
        slug: row.slug,
        name_ko: row.name_ko,
        region_sido: row.region_sido,
        region_sgg: row.region_sgg,
        facility_type: row.facility_type,
        is_active: row.is_active,
        closed_at: row.closed_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      gym: {
        id: gym.id,
        slug: gym.slug,
        name_ko: gym.name_ko,
        name_en: gym.name_en,
        brand_type: gym.brand_type,
        is_active: gym.is_active,
      },
    };
  });

  return {
    items,
    total: count ?? items.length,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}
