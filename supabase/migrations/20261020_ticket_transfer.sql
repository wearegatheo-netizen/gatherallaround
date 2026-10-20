-- ═══════════ 공연 예매: 티켓 양도(링크 방식) — 2026-10-20 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260824 이후)
--
-- 개념: 예매자가 좌석(티켓 1장)마다 48시간 1회용 양도 링크를 만들고, 받는 사람이 링크에서
-- 이름·연락처를 입력하면 그 좌석이 받는 사람 명의의 예매로 옮겨진다(좌석 코드·QR 재발급 → 원 QR 무효).
--   · 원 예매에 다른 활성 좌석이 남으면 → 새 예매(1매, confirmed)로 분리 + 원 예매 qty −1
--   · 마지막 1장이면 → 원 예매의 명의(이름·연락처)와 예매번호를 통째로 바꿈
--   · 받는 사람이 같은 공연에 활성 예매가 있으면 → 그 예매에 좌석을 합침(qty +1)
-- 총 매수가 변하지 않으므로 잔여석 뷰(event_seats)는 그대로. 모든 쓰기는 event-api(service role).
-- 토큰 평문은 저장하지 않는다(sha256 해시만) — 링크를 잃으면 취소 후 새로 만든다.

create table if not exists public.event_ticket_transfers (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  ticket_id     uuid not null references public.event_tickets(id) on delete cascade,  -- 양도하는(원) 예매
  seat_code     text not null,            -- 양도하는 좌석의 코드(생성 시점 값 — 수락 시 코드가 재발급되므로 이후엔 기록용)
  seat_no       int  not null,
  token_hash    text not null unique,     -- 링크 토큰(24자)의 sha256
  status        text not null default 'pending' check (status in ('pending','claimed','cancelled')),
  from_name     text not null,            -- 양도하는 사람 이름(받는 화면엔 가운데를 가려 표시)
  to_ticket_id  uuid references public.event_tickets(id) on delete set null,
  to_name       text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  claimed_at    timestamptz,
  cancelled_at  timestamptz
);
create index if not exists event_ticket_transfers_ticket_idx on public.event_ticket_transfers (ticket_id);
alter table public.event_ticket_transfers enable row level security;  -- 정책 없음(함수 전용)

-- 양도받은 표식: 예매 단위(분리·통째) + 좌석 단위(합치기 포함) — 받는 사람의 직접 취소를 막는 근거
alter table public.event_tickets add column if not exists transferred_from uuid references public.event_tickets(id) on delete set null;
alter table public.event_tickets add column if not exists transferred_from_name text;
alter table public.event_tickets add column if not exists transferred_at timestamptz;
alter table public.event_ticket_seats add column if not exists transferred_from_name text;
