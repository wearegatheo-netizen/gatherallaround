-- 공간 대관 승인(입금 확인) 안내 문자(2026-11-16): 예약마다 한 번만 보내려고 발송 시각을 적어 둔다.
-- 여러 번 실행해도 안전.
alter table public.performance_bookings add column if not exists approved_sms_sent_at timestamptz;

-- 이미 승인돼 있던 예약에는 지금 와서 문자가 나가지 않게 표시해 둔다(관리자가 다시 [승인]을 눌러도 안 나감).
update public.performance_bookings set approved_sms_sent_at = now()
 where status = 'approved' and approved_sms_sent_at is null;
