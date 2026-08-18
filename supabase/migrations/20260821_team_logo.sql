-- ═══════════ 공연 예매: 팀 로고 — 2026-08-21 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260820 이후)

alter table public.event_hosts add column if not exists logo_url text;

-- 공개 프로필 뷰에 로고 포함 (PII 없음)
create or replace view public.event_host_profiles as
  select id, name, bio, sns, logo_url from public.event_hosts;
grant select on public.event_host_profiles to anon, authenticated, service_role;
