-- 커뮤니티 상시 모집(2026-11-11): 날짜·시간 없이 모임을 등록할 수 있게 NOT NULL 을 푼다.
-- 이미 NULL 을 허용하고 있으면 아무 일도 일어나지 않는다(여러 번 실행해도 안전).
alter table public.community_meetings alter column meeting_date drop not null;
alter table public.community_meetings alter column meeting_time drop not null;
