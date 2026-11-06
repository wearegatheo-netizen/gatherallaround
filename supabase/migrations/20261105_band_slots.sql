-- ═══════════ 고정 합주팀: 실시간 가용 시간 띠·타임 신청·건너뛰기권 — 2026-11-05 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (전부 idempotent)
--
-- 배경: "고정 가능 시간" 표를 운영자가 손으로 고쳐 알려주던 것을 사이트가 실시간으로 계산한다.
--  · band_slot_defs   = 요일별 시간 띠(월 12~18 주간 / 18~23 야간 …) + 고정팀 신청 가능 여부·대관 가능 여부·개방일.
--  · band_slot_claims = 팀의 타임 신청(가입 신청 때 생성, 운영자 승인 때 time_blocks 로 달력에 반영 → block_id).
--  · band_skips       = 건너뛰기권. 승인 때 이미 잡힌 예약·대관·차단과 겹치는 주마다 1장, 운영자가 직접 부여도 가능.
--                       보상은 대체 합주(substitute: 건너뛰는 날 7일 전~전날, 같은 길이) 또는 1주 무료 연장(extend) 중 하나.
--                       선택 마감 = 건너뛰는 날 − 7일, 미선택이면 자동 extend(코드에서 lazy 판정 — index.html bandSkipResolution ·
--                       functions/send-reminders.js · supabase/functions/check-band-payments 세 곳 동일).
--  · time_blocks.skip_dates = 그 반복 차단이 적용되지 않는 날짜(건너뛰는 날) → 그날은 멤버 예약·대관이 가능해진다.
--    time_blocks.band_claim_id = 어느 타임 신청이 만든 차단인지(팀 종료 때 함께 닫음).
-- 시간 표기: defs/claims/skips 의 end_time 은 끝나는 시각(exclusive, '18:00' = 18시까지).
--            time_blocks.end_time 은 종전처럼 마지막 슬롯 시작('17:00') — 코드가 변환한다(_bandBlockEnd).

-- 0) 운영 계정 판정 헬퍼 (20261028_rls_band_polls.sql 과 동일 — 아직 실행 전이어도 여기서 만들어진다)
create or replace function public.band_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (lower(coalesce(p.instruments, '')) = 'wearegatheo'
           or lower(split_part(coalesce(p.email, ''), '@', 1)) = 'wearegatheo')
  );
$$;
revoke all on function public.band_is_admin() from public;
grant execute on function public.band_is_admin() to anon, authenticated;

-- 1) 시간 띠 정의
create table if not exists public.band_slot_defs (
  id          uuid primary key default gen_random_uuid(),
  day_of_week smallint not null check (day_of_week between 0 and 6),   -- 0=일 … 6=토 (time_blocks 와 동일)
  start_time  text not null,            -- '12:00' (예약 그리드 슬롯 시작)
  end_time    text not null,            -- '18:00' (끝나는 시각, exclusive)
  label       text not null default '주간' check (label in ('오전','주간','야간')),  -- 종전 timeslots 표기(월_야간)와 호환
  band_ok     boolean not null default true,    -- 고정팀 신청 가능
  rental_ok   boolean not null default true,    -- 공간 대관 가능(표시용)
  open_from   date,                             -- 이 날짜부터 신청 가능(null = 지금)
  note        text,
  created_at  timestamptz not null default now()
);
create unique index if not exists band_slot_defs_uniq on public.band_slot_defs (day_of_week, start_time);

-- 2) 타임 신청
create table if not exists public.band_slot_claims (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  def_id      uuid references public.band_slot_defs(id) on delete set null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time  text not null,
  end_time    text not null,            -- exclusive
  start_date  date not null,            -- 희망 시작일 → 승인 때 확정
  end_date    date,                     -- 종료(탈퇴·해제) 날짜
  status      text not null default 'pending' check (status in ('pending','approved','rejected','ended')),
  block_id    uuid,                     -- 승인 때 만든 time_blocks 행
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists band_slot_claims_profile on public.band_slot_claims (profile_id);

-- 3) 건너뛰기권
create table if not exists public.band_skips (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  claim_id             uuid references public.band_slot_claims(id) on delete set null,
  skip_date            date not null,   -- 건너뛰는 합주일
  skip_start           text not null,   -- 그날 원래 합주 시간(대체 합주 길이 계산용)
  skip_end             text not null,   -- exclusive
  reason               text,            -- '공간 대관' · '게더링 예약' · 운영자 메모
  resolution           text check (resolution in ('substitute','extend')),  -- null = 미선택(마감 지나면 extend 로 간주)
  substitute_date      date,
  substitute_start     text,
  substitute_end       text,            -- exclusive
  substitute_block_id  uuid,            -- 대체 합주 1회 차단(time_blocks)
  resolved_at          timestamptz,
  granted_by           text not null default 'signup' check (granted_by in ('signup','admin')),
  created_at           timestamptz not null default now(),
  unique (profile_id, skip_date, skip_start)
);
create index if not exists band_skips_profile on public.band_skips (profile_id);

-- 4) time_blocks 확장
alter table public.time_blocks
  add column if not exists band_claim_id uuid,
  add column if not exists skip_dates    date[] not null default '{}';

-- 5) RLS
alter table public.band_slot_defs enable row level security;
drop policy if exists band_slot_defs_read  on public.band_slot_defs;
drop policy if exists band_slot_defs_write on public.band_slot_defs;
create policy band_slot_defs_read  on public.band_slot_defs for select to anon, authenticated using (true);   -- 가입 화면(비로그인)이 읽는다
create policy band_slot_defs_write on public.band_slot_defs for all to authenticated
  using (public.band_is_admin()) with check (public.band_is_admin());

alter table public.band_slot_claims enable row level security;
drop policy if exists band_slot_claims_read   on public.band_slot_claims;
drop policy if exists band_slot_claims_insert on public.band_slot_claims;
drop policy if exists band_slot_claims_write  on public.band_slot_claims;
create policy band_slot_claims_read   on public.band_slot_claims for select to anon, authenticated using (true);   -- PII 없음(팀 id·요일·시간) — 가입 화면이 "다른 팀 신청 중" 표시
create policy band_slot_claims_insert on public.band_slot_claims for insert to authenticated
  with check (profile_id = auth.uid() or public.band_is_admin());
create policy band_slot_claims_write  on public.band_slot_claims for update to authenticated
  using (public.band_is_admin()) with check (public.band_is_admin());

alter table public.band_skips enable row level security;
drop policy if exists band_skips_read   on public.band_skips;
drop policy if exists band_skips_insert on public.band_skips;
drop policy if exists band_skips_update on public.band_skips;
drop policy if exists band_skips_delete on public.band_skips;
create policy band_skips_read   on public.band_skips for select to authenticated
  using (profile_id = auth.uid() or public.band_is_admin());
create policy band_skips_insert on public.band_skips for insert to authenticated
  with check (public.band_is_admin());
create policy band_skips_update on public.band_skips for update to authenticated       -- 팀은 본인 권의 보상 선택, 운영 계정은 전체
  using (profile_id = auth.uid() or public.band_is_admin())
  with check (profile_id = auth.uid() or public.band_is_admin());
create policy band_skips_delete on public.band_skips for delete to authenticated
  using (public.band_is_admin());

-- 합주팀 계정(authenticated)이 달력 계산·차단 생성에 쓰는 기존 테이블: anon 에게 이미 열려 있는 범위를 authenticated 에도 같게 연다
-- (카카오 멤버·운영자 화면이 anon 으로 같은 일을 하고 있어 노출 범위는 늘지 않는다)
alter table public.time_blocks enable row level security;
drop policy if exists time_blocks_authenticated_all on public.time_blocks;
create policy time_blocks_authenticated_all on public.time_blocks for all to authenticated using (true) with check (true);
drop policy if exists reservations_authenticated_read on public.reservations;
create policy reservations_authenticated_read on public.reservations for select to authenticated using (true);
drop policy if exists performance_bookings_authenticated_read on public.performance_bookings;
create policy performance_bookings_authenticated_read on public.performance_bookings for select to authenticated using (true);

-- 6) 시간 띠 초기값 — 「고정 가능 시간 (26.11.4. 기준)」 표. 운영자 화면(관리자 › ⏱️ 시간 띠)에서 언제든 수정.
--    화·수 야간은 기존 고정팀이 쓰고 있어 일단 신청 불가로 두고, 팀 관리에서 그 팀의 [고정 시간 등록]으로 달력에 반영한 뒤 신청 가능으로 바꾸면 "사용 중"이 자동 표시된다.
insert into public.band_slot_defs (day_of_week, start_time, end_time, label, band_ok, rental_ok, open_from, note) values
  (1, '12:00', '18:00', '주간', true,  true, null,         null),
  (1, '18:00', '23:00', '야간', true,  true, '2026-10-12', null),
  (2, '12:00', '18:00', '주간', true,  true, null,         null),
  (2, '18:00', '23:00', '야간', false, true, null,         '기존 고정팀 사용 중 — 팀 관리에서 달력에 반영한 뒤 신청 가능으로 바꾸세요'),
  (3, '12:00', '18:00', '주간', true,  true, null,         null),
  (3, '18:00', '23:00', '야간', false, true, null,         '기존 고정팀 사용 중 — 팀 관리에서 달력에 반영한 뒤 신청 가능으로 바꾸세요'),
  (4, '12:00', '18:00', '주간', true,  true, null,         null),
  (4, '18:00', '23:00', '야간', true,  true, null,         null),
  (5, '12:00', '18:00', '주간', true,  true, null,         null),
  (5, '18:00', '23:00', '야간', false, true, null,         '고정팀 불가'),
  (6, '09:00', '14:00', '오전', true,  true, '2026-11-14', null),
  (6, '14:00', '18:00', '주간', false, true, null,         '고정팀 불가 · 대관 가능'),
  (6, '18:00', '23:00', '야간', false, true, null,         '고정팀 불가 · 대관 가능'),
  (0, '09:00', '14:00', '오전', true,  true, '2026-11-22', null),
  (0, '14:00', '18:00', '주간', true,  true, '2026-11-22', null),
  (0, '18:00', '23:00', '야간', true,  true, null,         null)
on conflict (day_of_week, start_time) do nothing;

-- 확인
-- select day_of_week, start_time, end_time, label, band_ok, open_from from public.band_slot_defs order by day_of_week, start_time;
