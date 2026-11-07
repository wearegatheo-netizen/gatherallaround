-- ═══════════ 고정 합주팀 안내 문자 발송 기록 — 2026-11-07 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (idempotent)
-- /send-sms 가 가입 접수(signup)·승인(approve)·거절(reject) 문자를 보내기 전에 (profile_id, kind) 행을 먼저 넣어
-- 같은 팀·같은 종류는 1회만 나가게 한다(band_rent_reminders 와 같은 방식). 운영자 [승인 안내 문자 보내기]는 upsert 로 다시 보낸다.
create table if not exists public.band_sms_log (
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  kind       text        not null check (kind in ('signup','approve','reject')),
  sent_at    timestamptz not null default now(),
  to_phone   text,                       -- 가려진 번호(010****1234)만 저장
  primary key (profile_id, kind)
);
alter table public.band_sms_log enable row level security;
-- 읽기: 운영 계정(band_is_admin()) — 팀 관리 화면 발송 표시용. 쓰기 정책 없음 = service role(/send-sms) 만.
drop policy if exists band_sms_log_admin_read on public.band_sms_log;
create policy band_sms_log_admin_read on public.band_sms_log for select to authenticated using (public.band_is_admin());
