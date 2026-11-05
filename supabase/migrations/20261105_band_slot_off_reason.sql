-- ═══════════ 고정 합주팀 시간 띠: 고정팀 불가 사유 — 2026-11-05 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (idempotent)
-- band_ok=false 인 띠가 전부 「대관만」으로 보이던 것을 사유별로 나눈다:
--   rental = 고정팀은 받지 않고 대관만 받는 시간(토 주간·야간, 금 야간)  → 표에 「대관만」
--   team   = 기존 고정팀이 쓰고 있어 불가(화·수 야간, 달력 반영 전)       → 표에 「고정팀 사용 중」
-- 팀 관리 [+ 고정 시간]으로 그 팀을 달력에 반영한 뒤 띠의 고정팀 체크를 다시 켜면 차단에서 자동으로 「고정팀 사용 중」이 된다.
alter table public.band_slot_defs
  add column if not exists off_reason text not null default 'rental' check (off_reason in ('rental','team'));

update public.band_slot_defs set off_reason = 'team'
 where band_ok = false and day_of_week in (2, 3) and start_time = '18:00';   -- 화·수 야간 = 기존 고정팀

-- 확인
-- select day_of_week, start_time, band_ok, off_reason, note from public.band_slot_defs where band_ok = false order by day_of_week, start_time;
