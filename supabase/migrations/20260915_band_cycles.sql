-- ═══════════ 고정 합주팀: 회차(4주) 계약 정보 + 입금 안내 문자 — 2026-09-15 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (전부 idempotent)
--
-- 내부운영 구글시트 "진행중인 고정팀" 탭을 사이트로 이식한다.
--   시작일_n = band_start_date + 28n, 종료일_n = 시작일_n + 21(마지막 주 첫 합주일),
--   입금일_n = 시작일_n − 14 (n≥1, 3주차 사용일 = 다음 시작일 2주 전), 등록(n=0)은 시작일 당일 입금.
-- 매일 12:00 KST 크론(/send-reminders)이 미납 시 입금일 당일·4주차(시작 1주 전)·시작 전날 대표자에게 문자를 보내고,
-- band_rent_reminders(team_id, cycle_no, kind) PK 선점으로 회차·종류별 평생 1회만 발송한다.
-- 수식은 index.html bandCycle* / functions/send-reminders.js 와 동일하게 유지할 것.

-- 1) 팀 계약 정보 (profiles 는 개인 회원/합주팀 겸용 — 기존 band_* 컬럼 관행을 따름)
alter table public.profiles
  add column if not exists band_start_date      date,   -- 첫 회차 시작일(등록)
  add column if not exists band_expected_months text,   -- 예상 사용 개월수 ('6개월 이상' 등 자유 입력)
  add column if not exists band_deposit         int,    -- 보증금(원)
  add column if not exists band_deposit_paid_at date,   -- 보증금 입금일
  add column if not exists band_fee             int,    -- 회차(4주) 사용료(원) — 문자 본문에 표기
  add column if not exists band_ended_at        date,   -- 사용 종료일(탈퇴 처리 시 기록 → 히스토리)
  add column if not exists band_memo            text;

-- 2) 납부 장부: 회차 번호·금액 (기존 행은 null → 가장 가까운 회차 시작일로 귀속해 표시)
alter table public.band_payments
  add column if not exists cycle_no int,                -- 0=등록, 1=1차 추가 …
  add column if not exists amount   int;

-- 3) 문자 발송 선점·이력 (PII 없음)
create table if not exists public.band_rent_reminders (
  team_id  uuid not null references public.profiles(id) on delete cascade,
  cycle_no int  not null,
  kind     text not null check (kind in ('due','week4','last')),  -- 입금일(3주차) / 4주차(시작 1주 전) / 시작 전날
  sent_at  timestamptz not null default now(),
  primary key (team_id, cycle_no, kind)
);
alter table public.band_rent_reminders enable row level security;
-- 읽기: 로그인(authenticated) 사용자 — 게더링 팀 관리 화면의 발송 이력 표시용. 쓰기 정책 없음 = service role 만.
drop policy if exists band_rent_reminders_read on public.band_rent_reminders;
create policy band_rent_reminders_read on public.band_rent_reminders
  for select to authenticated using (true);
