-- ═══════════ 고정 합주팀: 등록 비밀번호 숫자 4자리(운영자 전용) — 2026-11-05 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (idempotent)
-- 가입 비밀번호는 'pw' + 숫자 4자리인데 auth 는 해시만 보관해 운영자가 숫자를 볼 수 없다.
-- 숫자 4자리는 6개월 이상 사용·캐비넷 이용 시 등록 비밀번호가 되므로, 운영자만 읽을 수 있는 표에 따로 둔다.
--  · 읽기: 운영 계정(band_is_admin())만 — 팀 본인도 못 읽는다(이미 아는 값). anon 정책 없음.
--  · 쓰기: 가입 직후 본인(profile_id = auth.uid()) insert/upsert, 운영자는 전부(팀 관리 › 계약 정보에서 수정·삭제).
create table if not exists public.band_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin        text not null check (pin ~ '^[0-9]{4}$'),
  updated_at timestamptz not null default now()
);
alter table public.band_pins enable row level security;
drop policy if exists band_pins_read   on public.band_pins;
drop policy if exists band_pins_insert on public.band_pins;
drop policy if exists band_pins_update on public.band_pins;
drop policy if exists band_pins_delete on public.band_pins;
create policy band_pins_read   on public.band_pins for select to authenticated using (public.band_is_admin());
create policy band_pins_insert on public.band_pins for insert to authenticated with check (profile_id = auth.uid() or public.band_is_admin());
create policy band_pins_update on public.band_pins for update to authenticated
  using (profile_id = auth.uid() or public.band_is_admin()) with check (profile_id = auth.uid() or public.band_is_admin());
create policy band_pins_delete on public.band_pins for delete to authenticated using (public.band_is_admin());
