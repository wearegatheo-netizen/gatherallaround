-- ============================================================================
-- 커뮤니티 모임 상태 컬럼 (2026-10-13) — 게더링 차단 시간(time_blocks) 사용 요청
--   active   : 공개 (기본값 — 기존 행 전부)
--   pending  : 모임장이 게더링이 막아 둔 시간을 골라 운영진 수락을 기다리는 중 (목록 비공개)
--   rejected : 운영진 거절 (비공개)
-- 상태 변경은 functions/community-admin.js(service role, 운영 총괄 인증)만 한다 —
-- anon UPDATE 는 20260708_community_enforcement.sql 에서 회수돼 있음.
-- SQL Editor 에서 1회 실행.
-- ============================================================================

alter table public.community_meetings
  add column if not exists status text not null default 'active';

alter table public.community_meetings
  drop constraint if exists community_meetings_status_check;
alter table public.community_meetings
  add constraint community_meetings_status_check check (status in ('active', 'pending', 'rejected'));

-- 운영진이 수락/거절한 시각 (community-admin.js 가 기록)
alter table public.community_meetings
  add column if not exists reviewed_at timestamptz;

create index if not exists community_meetings_status_idx on public.community_meetings (status);

-- 확인:
--   select id, title, status, reviewed_at from public.community_meetings order by created_at desc limit 5;
