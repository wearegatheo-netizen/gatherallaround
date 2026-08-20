-- ═══════════ 공연 예매: 예매자 질문 복수화 — 2026-08-27 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260826 이후)
--
-- 질문을 최대 5개까지: events.booking_questions jsonb — [{ "q": "...", "required": bool }]
-- 답변은 event_tickets.answer(text)에 [{ "q": "...", "a": "..." }] JSON으로 저장.
-- 기존 단일 질문(booking_question/_required)은 배열로 이관하고, 구 컬럼은
-- 배포 전환기 호환용으로 유지(서버가 첫 질문을 계속 동기).

alter table public.events add column if not exists booking_questions jsonb;

update public.events
   set booking_questions = jsonb_build_array(
         jsonb_build_object('q', booking_question, 'required', coalesce(booking_question_required, false)))
 where booking_question is not null
   and booking_questions is null;
