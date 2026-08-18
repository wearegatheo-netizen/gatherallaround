-- ═══════════ 공연 예매: 공연별 공동 관리팀 (연합공연) — 2026-08-22 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260821 이후)
--
-- 개념: 공연(event)에 다른 '팀'을 통째로 초대해 함께 관리한다.
-- 팀 내부 멤버 초대(event_host_members)와는 별개 축 —
--   사람 ∈ 팀 (event_host_members) / 팀 ∈ 공연 관리 (event_co_teams).
-- 공연 관리 권한 = 주최팀 멤버 ∪ 공동 관리팀 멤버.

create table if not exists public.event_co_teams (
  event_id   uuid not null references public.events(id) on delete cascade,
  host_id    uuid not null references public.event_hosts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, host_id)
);
alter table public.event_co_teams enable row level security;  -- 정책 없음(함수 전용)

-- 공연 관리팀 초대 토큰 (7일, 공연당 1개 대체)
create table if not exists public.event_co_invites (
  token      text primary key,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_by text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.event_co_invites enable row level security;  -- 정책 없음

-- 예매 페이지 표시용 공개 뷰 (PII 없음 — 팀명·로고만)
create or replace view public.event_co_hosts_public as
  select ect.event_id, eh.id as host_id, eh.name, eh.logo_url
  from public.event_co_teams ect
  join public.event_hosts eh on eh.id = ect.host_id;
grant select on public.event_co_hosts_public to anon, authenticated, service_role;
