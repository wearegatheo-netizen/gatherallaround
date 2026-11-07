-- ═══════════ 고정 합주팀: 캐비넷 사용 여부 — 2026-11-07 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (idempotent)
-- 가입 폼에서 받는 「캐비넷 사용」(true/false, null = 미응답·옛 가입). 규칙: 예상 사용 기간(band_expected_months) 6개월 이상 팀은 무료,
-- 미만은 회차당 2만원(이용료와 함께 입금). 운영자는 계약 정보 폼에서 바꿀 수 있다. 문자(send-sms·send-reminders)·화면이 같은 규칙으로 표시.
alter table public.profiles add column if not exists band_cabinet boolean;
