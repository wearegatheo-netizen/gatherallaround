-- ═══════════ 공연 예매: 예매자 질문 — 2026-08-25 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260824 이후)
--
-- 호스트가 공연 등록 시 예매자에게 물어볼 질문(선택)을 설정하면
-- 예매 작성 화면에 표시되고, 답변은 티켓에 저장돼 예매자 관리·CSV에 나온다.

alter table public.events add column if not exists booking_question text;
alter table public.event_tickets add column if not exists answer text;
