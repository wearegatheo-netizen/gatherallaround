-- ═══════════ 고정 합주팀: 팀이 직접 요청하는 대체 합주(이용 기간 중 1회) — 2026-11-07 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (idempotent)
-- 팀 사정으로 고정 시간을 쓰기 어려운 주가 생기면, 팀이 로그인해 건너뛸 날 3일 전까지 앞뒤 1주일 안 빈 시간으로 대체 합주를 1회 직접 잡는다.
-- band_skips 에 granted_by='team' 행(resolution='substitute' 로 바로 확정)을 본인이 넣을 수 있게 하고, 부분 유니크 인덱스로 팀당 1회를 DB 가 보장한다.
-- 운영자가 그 행을 [삭제]하면 요청권이 다시 생긴다(추가 허용은 기존 [+ 건너뛰기권]).
alter table public.band_skips drop constraint if exists band_skips_granted_by_check;
alter table public.band_skips add constraint band_skips_granted_by_check check (granted_by in ('signup','admin','team'));
drop policy if exists band_skips_team_insert on public.band_skips;
create policy band_skips_team_insert on public.band_skips for insert to authenticated
  with check (profile_id = auth.uid() and granted_by = 'team');
create unique index if not exists band_skips_team_once on public.band_skips (profile_id) where granted_by = 'team';
