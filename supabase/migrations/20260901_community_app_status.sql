-- ═══════════ 커뮤니티 모임: 신청 상태·메일 발송 기록 — 2026-09-01 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260831 이후)
--
-- ① status: 신청자 관리(수락/거절)용 — pending(대기)/accepted(수락)/rejected(거절).
--    거절된 신청은 정원 계산에서 제외된다 (자리가 다시 열림).
-- ② notified_at: 신청 접수 시 모임장 알림 메일(/send-email, Resend)의
--    1회 발송 보장 선점 마커 (sms_sent_at과 동일 패턴).
-- ③ 수락/거절은 클라이언트(anon)에서 status를 update하므로 정책 보강 —
--    기존에 insert/select/delete가 이미 anon으로 열려 있는 것과 같은 수준.

alter table public.community_applications add column if not exists status text not null default 'pending';
alter table public.community_applications add column if not exists notified_at timestamptz;

drop policy if exists "allow update applications" on public.community_applications;
create policy "allow update applications" on public.community_applications
  for update using (true) with check (true);
