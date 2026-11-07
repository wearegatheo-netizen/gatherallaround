-- ═══════════ 고정 합주팀: 시간 띠별 4주 이용료 — 2026-11-07 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (idempotent)
-- 보증금(1개월분) 입금 안내를 가입 접수 단계에서 금액까지 하려면 띠별 4주 이용료가 필요하다. 운영자가 「시간 띠」 탭에서 적는다(원).
-- 가입 신청 때 고른 띠의 이용료 합이 profiles.band_fee(4주 이용료)·band_deposit(1개월분 보증금)에 미리 들어가고, 접수 문자가 그 금액과 계좌를 안내한다.
alter table public.band_slot_defs add column if not exists fee integer;
