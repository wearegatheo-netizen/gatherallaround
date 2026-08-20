-- ═══════════ 공연 예매: 매수별 QR (좌석 단위 체크인) — 2026-08-23 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260822 이후)
--
-- 개념: 예매 1건(qty N) → 좌석 N개. 좌석마다 고유 6자리 코드·QR이 발급되어
-- 동행인에게 한 장씩 나눠줄 수 있고, 입장(체크인)은 좌석 단위로 처리된다.
-- 1번 좌석 코드 = 티켓 예매번호(기발급 QR 그대로 유효). 나머지 좌석 코드는
-- event-api가 조회 시점에 지연 생성한다.

create table if not exists public.event_ticket_seats (
  code          text primary key,        -- 좌석 QR 코드 (6자리, 예매번호와 동일 charset)
  ticket_id     uuid not null references public.event_tickets(id) on delete cascade,
  seat_no       int  not null,
  checked_in_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (ticket_id, seat_no)
);
create index if not exists event_ticket_seats_ticket_idx on public.event_ticket_seats (ticket_id);
alter table public.event_ticket_seats enable row level security;  -- 정책 없음(함수 전용)

-- 백필: 기존 티켓의 1번 좌석 = 티켓 코드, 체크인 상태 이관 (qty>1의 나머지 좌석은 API가 지연 생성)
insert into public.event_ticket_seats (code, ticket_id, seat_no, checked_in_at)
  select t.code, t.id, 1, t.checked_in_at
  from public.event_tickets t
  on conflict do nothing;
