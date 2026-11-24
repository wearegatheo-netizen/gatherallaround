-- 고정 합주팀 운영 안내의 「로그인한 팀에게만 보일 값」(2026-11-24) — 출입 번호·담당자 연락처.
-- 공개 저장소·공개 JS 에 적지 않으려고 DB 에 둔다. 값은 운영 계정(wearegatheo)이 팀 화면 › 운영 안내 › 기본 정보의 입력 칸에서 넣는다.
--   key: door_1f(1층 현관) · door_b1(지하 1층) · ops_contact(운영담당자) · sound_contact(음향담당자)
-- 읽기: 승인된 합주팀 계정 + 운영 계정만(비로그인·게더링 멤버·승인 전 팀은 못 읽는다).  쓰기: 운영 계정만.
-- 여러 번 실행해도 안전.

create table if not exists public.band_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- 운영 계정 판정(20261028_rls_band_polls.sql · 20261105_band_slots.sql 과 같은 정의 — 아직 없어도 여기서 만들어진다)
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

-- 승인된 합주팀 계정인가
create or replace function public.band_is_approved()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.member_type = 'band' and p.status = 'approved'
  );
$$;
revoke all on function public.band_is_approved() from public;
grant execute on function public.band_is_approved() to anon, authenticated;

alter table public.band_settings enable row level security;
drop policy if exists band_settings_read  on public.band_settings;
drop policy if exists band_settings_write on public.band_settings;
create policy band_settings_read  on public.band_settings for select to authenticated
  using (public.band_is_approved() or public.band_is_admin());
create policy band_settings_write on public.band_settings for all to authenticated
  using (public.band_is_admin()) with check (public.band_is_admin());

revoke all on public.band_settings from anon;
grant select, insert, update, delete on public.band_settings to authenticated;
