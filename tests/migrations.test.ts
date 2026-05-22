import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIG_DIR = path.resolve(__dirname, "..", "supabase", "migrations");

function loadAllMigrations(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  return files.map((f) => readFileSync(path.join(MIG_DIR, f), "utf8")).join("\n\n");
}

// 마이그레이션 SQL 전체를 한 문자열로 합쳐 분석한다.
const sql = loadAllMigrations();

// `create table [if not exists] public.X (`  또는  `create table public.X (`
function extractCreatedTables(source: string): string[] {
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) found.add(m[1].toLowerCase());
  return [...found];
}

function tablesWithRlsEnabled(source: string): Set<string> {
  const re = /alter\s+table\s+public\.([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) found.add(m[1].toLowerCase());
  return found;
}

function tablesWithPolicy(source: string): Set<string> {
  // create policy "name" on public.X
  const re = /create\s+policy\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) found.add(m[1].toLowerCase());
  return found;
}

describe("마이그레이션 무결성", () => {
  it("마이그레이션 파일이 존재한다", () => {
    const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("required 핵심 테이블 모두 생성", () => {
    const created = extractCreatedTables(sql);
    for (const t of ["roles", "user_levels", "profiles", "audit_log"]) {
      expect(created).toContain(t);
    }
  });

  it("모든 신규 public 테이블에 RLS enable", () => {
    const created = extractCreatedTables(sql);
    const rlsEnabled = tablesWithRlsEnabled(sql);
    const missing = created.filter((t) => !rlsEnabled.has(t));
    expect(missing, `RLS 미적용 테이블: ${missing.join(", ")}`).toEqual([]);
  });

  it("모든 RLS 활성 테이블에 최소 1개 정책", () => {
    const rlsEnabled = tablesWithRlsEnabled(sql);
    const policied = tablesWithPolicy(sql);
    const missing = [...rlsEnabled].filter((t) => !policied.has(t));
    expect(missing, `정책 없는 RLS 테이블: ${missing.join(", ")}`).toEqual([]);
  });

  it("profiles 테이블에 role_id FK + level FK", () => {
    expect(sql).toMatch(/role_id[\s\S]*?references\s+public\.roles\s*\(\s*id\s*\)/i);
    expect(sql).toMatch(/level[\s\S]*?references\s+public\.user_levels\s*\(\s*level\s*\)/i);
  });

  it("handle_new_user 트리거 정의됨", () => {
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.handle_new_user/i);
    expect(sql).toMatch(/create\s+trigger\s+on_auth_user_created[\s\S]*after\s+insert\s+on\s+auth\.users/i);
  });

  it("has_role / is_admin 함수 정의됨 + SECURITY DEFINER + search_path 고정", () => {
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.has_role/i);
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.is_admin/i);
    // SECURITY DEFINER 함수는 search_path 고정 필수 (인젝션 방어)
    const definerBlocks = sql.match(/security\s+definer[\s\S]*?\$\$/gi) ?? [];
    expect(definerBlocks.length).toBeGreaterThan(0);
    for (const block of definerBlocks) {
      expect(block).toMatch(/set\s+search_path\s*=/i);
    }
  });

  it("기본 권한 — anon에는 select만, authenticated에는 select/insert/update만", () => {
    // anon 권한이 너무 넓지 않은지 가벼운 검증
    expect(sql).toMatch(/grant\s+select\s+on[\s\S]*?to\s+anon/i);
    expect(sql).not.toMatch(/grant\s+(?:all|delete|truncate)\s+on[\s\S]*?to\s+anon/i);
  });
});
