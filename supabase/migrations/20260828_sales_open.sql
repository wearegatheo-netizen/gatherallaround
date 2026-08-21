-- ═══════════ 공연 예매: 예매 오픈 일시 — 2026-08-28 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260827 이후)
--
-- 호스트가 예매 오픈 날짜·시간을 따로 설정하면 그 전에는 목록·상세에
-- '오픈 예정'으로 표시되고 예매가 차단된다(클라이언트 + 서버 book 이중).
-- 비워두면 기존처럼 공개 즉시 예매 가능.

alter table public.events add column if not exists sales_open_at timestamptz;
