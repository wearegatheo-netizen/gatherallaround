-- ═══════════ RLS 켜기: band_members / band_comments / band_notices / polls / poll_votes — 2026-10-28 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (Security Advisor `rls_disabled_in_public` 5개 테이블)
--
-- 배경: 대시보드에서 직접 만든 옛 테이블 5개가 RLS 없이 anon 키로 전부 읽기·쓰기·삭제 가능했다.
-- 원칙: 지금 화면이 하는 동작은 그대로 허용하고, 그 이상은 막는다.
--  · 합주팀(band_*) 화면은 Supabase 이메일 로그인(authenticated) — profiles.id = auth.uid() 이므로 본인 팀 행만.
--    게더링 운영 계정(로그인 ID `wearegatheo` = profiles.instruments 또는 이메일 접두)은 전체.
--  · 투표(polls/poll_votes)는 게더링 멤버 화면 — 카카오 로그인이라 Supabase 세션이 없어(anon) 서버가 사람을 구분할 수 없다.
--    그래서 종전과 같은 범위(anon·authenticated 전부 허용)로만 두고 RLS 를 켠다 → 경고는 해소되지만 실질 보호는 없음.
--    진짜로 잠그려면 투표 쓰기를 서버 함수(service role + 카카오 토큰 검증)로 옮겨야 한다(별도 작업).
-- 서버 함수(send-reminders 등)는 service role 이라 RLS 와 무관.

-- 0) 운영 계정 판정 헬퍼 — 정책 안에서 profiles 를 읽어야 하므로 security definer(호출자 권한으로는 profiles RLS 에 막힐 수 있음)
create or replace function public.band_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (lower(coalesce(p.instruments, '')) = 'wearegatheo'
           or lower(split_part(coalesce(p.email, ''), '@', 1)) = 'wearegatheo')
  );
$$;
revoke all on function public.band_is_admin() from public;
grant execute on function public.band_is_admin() to anon, authenticated;

-- 1) 기존 정책이 남아 있으면 전부 제거(permissive 정책은 OR 로 합쳐져 구멍이 되므로 깨끗이 시작)
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('band_members','band_comments','band_notices','polls','poll_votes')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2) band_members — 팀원 명단: 본인 팀만 읽기·추가·삭제, 운영 계정은 전체(관리 화면이 전 팀 명단을 읽는다)
alter table public.band_members enable row level security;
create policy band_members_select on public.band_members for select to authenticated
  using (band_profile_id = auth.uid() or public.band_is_admin());
create policy band_members_insert on public.band_members for insert to authenticated
  with check (band_profile_id = auth.uid() or public.band_is_admin());
create policy band_members_update on public.band_members for update to authenticated
  using (band_profile_id = auth.uid() or public.band_is_admin())
  with check (band_profile_id = auth.uid() or public.band_is_admin());
create policy band_members_delete on public.band_members for delete to authenticated
  using (band_profile_id = auth.uid() or public.band_is_admin());

-- 3) band_comments — 요청사항(팀 → 게더링 창구): 로그인한 팀은 전체 열람(화면이 전체를 그린다), 쓰기는 본인 팀 명의만, 삭제는 본인 팀·운영 계정
alter table public.band_comments enable row level security;
create policy band_comments_select on public.band_comments for select to authenticated
  using (true);
create policy band_comments_insert on public.band_comments for insert to authenticated
  with check (band_profile_id = auth.uid() or public.band_is_admin());
create policy band_comments_delete on public.band_comments for delete to authenticated
  using (band_profile_id = auth.uid() or public.band_is_admin());

-- 4) band_notices — 공지: 로그인한 팀은 읽기만, 등록·수정·삭제는 운영 계정만(화면도 운영 계정에만 폼을 보인다)
alter table public.band_notices enable row level security;
create policy band_notices_select on public.band_notices for select to authenticated
  using (true);
create policy band_notices_write on public.band_notices for all to authenticated
  using (public.band_is_admin()) with check (public.band_is_admin());

-- 5) polls / poll_votes — 게더링 투표: 카카오 로그인(anon)이라 종전 범위 그대로 허용(위 배경 참고)
alter table public.polls enable row level security;
create policy polls_all on public.polls for all to anon, authenticated
  using (true) with check (true);
alter table public.poll_votes enable row level security;
create policy poll_votes_all on public.poll_votes for all to anon, authenticated
  using (true) with check (true);

-- 확인: 아래가 0건이면 완료
-- select tablename from pg_tables where schemaname='public' and not rowsecurity;
