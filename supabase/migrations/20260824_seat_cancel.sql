-- ═══════════ 공연 예매: 좌석(티켓 1장) 단위 취소 — 2026-08-24 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260823 이후)
--
-- 개념: 3장 예매 중 1장만 취소하는 부분 취소.
-- 취소된 좌석은 cancelled_at으로 표시하고, event_tickets.qty를 1 차감한다
-- (event_seats 뷰의 잔여석·입금 금액이 qty 기준이므로 함께 정합 유지).
-- 활성 좌석이 마지막 1장일 때의 취소는 예매 전체 취소로 전환된다.

alter table public.event_ticket_seats add column if not exists cancelled_at timestamptz;
