-- ═══════════ 고정 합주팀: 고정 사용 종료 예정일 — 2026-11-05 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (idempotent)
-- band_ended_at 은 「탈퇴 처리한 날」(즉시 종료·히스토리)이고, band_end_date 는 운영자가 미리 정하는 「사용 종료 예정일」(마지막 사용일, 포함).
-- 저장하면 그 팀의 고정 시간 차단(time_blocks)·타임 신청(band_slot_claims)에 같은 end_date 가 들어가 달력이 그다음 날부터 열리고,
-- 회차 안내·입금 문자는 종료일 뒤 회차를 만들지 않는다. 날짜가 지나면 화면·서버가 종료 팀으로 다룬다(lazy, band_ended_at 은 그대로).
alter table public.profiles add column if not exists band_end_date date;
