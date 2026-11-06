-- ═══════════ 게더링 일정표: 외부인 참여 신청(schedule_guests) — 2026-11-02 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회.
--
-- 멤버가 본인 신청 외에 데려오는 외부인(친구·지인)을 슬롯별로 "몇 명·누구" 적어 두는 표.
-- 멤버 1명당 슬롯마다 한 줄(인원 수 + 이름 메모) — 수정은 같은 줄을 덮어쓴다. 전체 참여자 수에 합산되고
-- 참여 횟수(멤버 출석 집계)에는 들어가지 않는다. 슬롯 키는 index.html slotAttKey 와 동일('slot|<그룹>|<시작시각>').
-- RLS: 게더링 멤버는 카카오 로그인(anon 키)이라 schedule_attendees 와 같은 전면 허용 정책 — 서버가 사람을 가리지 못한다.

create table if not exists public.schedule_guests (
  id              uuid primary key default gen_random_uuid(),
  schedule_date   date not null,
  slot_key        text not null default '',
  host_profile_id uuid not null references public.profiles(id) on delete cascade,  -- 데려오는 멤버
  guest_count     int  not null check (guest_count between 1 and 30),
  guest_names     text not null default '',   -- "홍길동, 김영희(친구)" 같은 자유 메모
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (schedule_date, slot_key, host_profile_id)
);
create index if not exists schedule_guests_date_idx on public.schedule_guests (schedule_date);
alter table public.schedule_guests enable row level security;
drop policy if exists schedule_guests_all on public.schedule_guests;
create policy schedule_guests_all on public.schedule_guests for all to anon, authenticated using (true) with check (true);
