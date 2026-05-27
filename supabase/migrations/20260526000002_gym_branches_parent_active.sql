-- HIGH-1 회귀 패치
-- gym_branches.SELECT 정책에 부모 gyms.is_active 검사를 추가한다.
-- 기존 정책은 자기 is_active = true 만 검사해, 부모 체인이 비활성이어도
-- 자식 지점들이 anon SELECT 결과에 노출되는 RLS 우회 가능성이 있었다.

drop policy if exists gym_branches_read_active on public.gym_branches;
create policy gym_branches_read_active on public.gym_branches
  for select using (
    public.is_admin() or (
      is_active = true and exists (
        select 1 from public.gyms g
        where g.id = gym_branches.gym_id and g.is_active = true
      )
    )
  );
