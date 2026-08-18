-- ═══════════════ 공연 티켓 예매 (두둥식) — 2026-08-18 ═══════════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회.
--
-- 설계 원칙:
--   * 쓰기는 전부 Cloudflare Pages Function(/event-api, service role)이 수행한다.
--   * 클라이언트(anon)는 events 읽기와 event_seats(집계 뷰) 읽기만 가능.
--   * event_hosts / event_tickets 에는 전화번호 등 PII가 있어 anon 정책이 아예 없다
--     (정책 0개 = RLS 전면 차단, service role만 접근).
--   * 좌석 정합성의 유일한 진실은 book_event_ticket RPC — 공연 행 FOR UPDATE 잠금으로
--     정원 초과 경쟁 조건을 원천 차단한다. 함수 밖 read-then-write 예매 금지.

create extension if not exists pgcrypto;

-- 1) 호스트 — 카카오 로그인 기반, 게더링 멤버십(profiles)과 완전 분리
create table if not exists public.event_hosts (
  id            uuid primary key default gen_random_uuid(),
  kakao_id      text unique not null,
  name          text not null check (char_length(name) between 1 and 40),
  contact_phone text,
  bank_info     text,                     -- 기본 입금 계좌 (예: "토스뱅크 0000-0000-0000 홍길동")
  created_at    timestamptz not null default now()
);

-- 2) 공연
create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.event_hosts(id),
  host_name       text not null,          -- 표시용 복제 — event_hosts는 비공개 테이블이라 join 불가
  title           text not null check (char_length(title) between 1 and 80),
  description     text,
  poster_url      text,
  venue           text not null check (char_length(venue) between 1 and 120),
  starts_at       timestamptz not null,
  capacity        int  not null check (capacity between 1 and 1000),
  price           int  not null default 0 check (price between 0 and 1000000),
  bank_info       text,                   -- 유료 공연 입금 계좌 (공연별)
  max_per_booking int  not null default 4 check (max_per_booking between 1 and 10),
  status          text not null default 'published' check (status in ('published','closed','hidden')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists events_list_idx on public.events (status, starts_at);

-- 3) 티켓
create table if not exists public.event_tickets (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  code          text unique not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  buyer_name    text not null check (char_length(buyer_name) between 1 and 40),
  buyer_phone   text not null check (buyer_phone ~ '^01[016789][0-9]{7,8}$'),
  qty           int  not null check (qty between 1 and 10),
  status        text not null check (status in ('pending_payment','confirmed','cancelled')),
  checked_in_at timestamptz,
  confirmed_at  timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  text check (cancelled_by in ('buyer','host')),
  created_at    timestamptz not null default now()
);
create index if not exists event_tickets_event_idx on public.event_tickets (event_id);
-- 같은 공연에 같은 전화번호 중복 예매 방지 (활성 건 한정 — 취소 후 재예매는 허용)
create unique index if not exists event_tickets_phone_uniq
  on public.event_tickets (event_id, buyer_phone)
  where status in ('pending_payment','confirmed');

-- 4) RLS
alter table public.event_hosts   enable row level security;  -- 정책 없음 = anon/auth 전면 차단
alter table public.event_tickets enable row level security;  -- 정책 없음
alter table public.events        enable row level security;
drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select using (status <> 'hidden');
-- insert/update/delete 정책 없음 → 클라이언트 쓰기 불가 (service role만)

-- 5) 잔여석 공개 뷰 — PII 없는 집계만 노출.
--    의도적으로 definer 방식(뷰 소유자 권한으로 event_tickets RLS 우회).
--    Supabase linter의 'security definer view' 경고는 이 설계의 의도된 결과.
create or replace view public.event_seats as
  select e.id as event_id, e.capacity,
         coalesce(sum(t.qty) filter (where t.status in ('pending_payment','confirmed')), 0)::int as taken
  from public.events e
  left join public.event_tickets t on t.event_id = e.id
  where e.status <> 'hidden'
  group by e.id, e.capacity;
grant select on public.event_seats to anon, authenticated, service_role;

-- 6) 예매 RPC — 좌석 정합성의 유일한 진실 (service role 전용)
create or replace function public.book_event_ticket(
  p_event_id uuid, p_name text, p_phone text, p_qty int, p_code text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ev     events%rowtype;
  v_taken  int;
  v_status text;
  v_ticket event_tickets%rowtype;
begin
  select * into v_ev from events where id = p_event_id for update;
  if not found or v_ev.status = 'hidden' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_ev.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if v_ev.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'started');
  end if;
  if p_qty < 1 or p_qty > v_ev.max_per_booking then
    return jsonb_build_object('ok', false, 'error', 'bad_qty', 'max', v_ev.max_per_booking);
  end if;
  if exists (select 1 from event_tickets
             where event_id = p_event_id and buyer_phone = p_phone
               and status in ('pending_payment','confirmed')) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;
  select coalesce(sum(qty), 0) into v_taken from event_tickets
   where event_id = p_event_id and status in ('pending_payment','confirmed');
  if v_taken + p_qty > v_ev.capacity then
    return jsonb_build_object('ok', false, 'error', 'sold_out',
                              'remaining', greatest(v_ev.capacity - v_taken, 0));
  end if;
  v_status := case when v_ev.price = 0 then 'confirmed' else 'pending_payment' end;
  insert into event_tickets (event_id, code, buyer_name, buyer_phone, qty, status, confirmed_at)
  values (p_event_id, upper(p_code), p_name, p_phone, p_qty, v_status,
          case when v_ev.price = 0 then now() end)
  returning * into v_ticket;
  return jsonb_build_object('ok', true,
    'ticket', to_jsonb(v_ticket),
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'host_name', v_ev.host_name,
      'venue', v_ev.venue, 'starts_at', v_ev.starts_at, 'price', v_ev.price,
      'bank_info', v_ev.bank_info, 'status', v_ev.status));
exception when unique_violation then
  -- 전화 중복은 잠금 하에서 위에서 걸렀으므로 여기 도달 = code 충돌 → 호출측이 새 코드로 재시도
  return jsonb_build_object('ok', false, 'error', 'code_collision');
end $$;
revoke execute on function public.book_event_ticket(uuid,text,text,int,text) from public, anon, authenticated;
grant  execute on function public.book_event_ticket(uuid,text,text,int,text) to service_role;
