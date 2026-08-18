-- ═══════════ 공연 예매: 멀티팀 + 공동호스트 — 2026-08-20 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260819 이후)
--
-- 모델 변경: 한 카카오 계정이 여러 팀을 소유할 수 있고, 한 팀에 여러
-- 공동호스트(멤버)가 있을 수 있다. 팀-사람 관계는 event_host_members가 담당.
-- event_hosts.kakao_id는 '창설자' 기록으로만 남기고 유니크 제약을 푼다.

-- 1) 팀 멤버십
create table if not exists public.event_host_members (
  host_id    uuid not null references public.event_hosts(id) on delete cascade,
  kakao_id   text not null,
  name       text,                -- 표시용 카카오 닉네임 (합류 시점 저장)
  role       text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (host_id, kakao_id)
);

-- 기존 팀 소유자를 owner 멤버로 이관 (기존 공연 소유권 연속성 유지)
insert into public.event_host_members (host_id, kakao_id, name, role)
  select id, kakao_id, name, 'owner' from public.event_hosts
  on conflict do nothing;

-- 2) 한 계정 여러 팀 허용
alter table public.event_hosts drop constraint if exists event_hosts_kakao_id_key;

-- 3) 공동호스트 초대 토큰 (7일 유효, 만료 전 여러 명 수락 가능)
create table if not exists public.event_host_invites (
  token      text primary key,
  host_id    uuid not null references public.event_hosts(id) on delete cascade,
  created_by text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- 4) RLS: 정책 없음 = anon 전면 차단 (모든 접근은 /event-api service role)
alter table public.event_host_members enable row level security;
alter table public.event_host_invites enable row level security;
