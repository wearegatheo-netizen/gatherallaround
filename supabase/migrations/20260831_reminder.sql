-- ═══════════ 공간 대관: 이용일 임박(D-2) 관리자 알림 — 2026-08-31 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260829 이후)
--
-- 매일 08:00 KST에 GitHub Actions 크론이 /send-reminders 를 호출해,
-- 이용일이 이틀 앞으로 다가온 승인 예약을 관리자 푸시로 알린다.
-- reminder_sent_at 은 건당 평생 1회 발송을 보장하는 선점 마커
-- (sms_sent_at 과 동일 패턴).

alter table public.performance_bookings add column if not exists reminder_sent_at timestamptz;
