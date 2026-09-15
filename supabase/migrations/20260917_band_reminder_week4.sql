-- ═══════════ 고정 합주팀 문자: 4주차(시작 1주 전) 리마인드 종류 추가 — 2026-09-17 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260915 이후. 20260915 를 이 시점 이후에 처음 실행했다면 이미 반영돼 있어 무해)
-- band_rent_reminders.kind 허용값에 'week4' 추가 — 미납 시 회차당 최대 3회(due → week4 → last).
alter table public.band_rent_reminders drop constraint if exists band_rent_reminders_kind_check;
alter table public.band_rent_reminders add constraint band_rent_reminders_kind_check check (kind in ('due','week4','last'));
