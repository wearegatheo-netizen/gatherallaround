-- ═══════════ 공연 예매: 예매자 질문 필수/선택 — 2026-08-26 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260825 이후)
--
-- 호스트가 예매자 질문을 '필수 응답'으로 설정하면 답변 없이는 예매가 안 된다
-- (클라이언트 검증 + 서버 book 검증 이중).

alter table public.events add column if not exists booking_question_required boolean not null default false;
