-- ═══════════ 공연 예매 개선: 호스트 팀 프로필 + 장소 좌표 — 2026-08-19 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260818_event_ticketing.sql 이후)

-- 호스트를 '공연 주최팀' 중심으로: 팀 소개·SNS 링크
alter table public.event_hosts add column if not exists bio text;
alter table public.event_hosts add column if not exists sns text;

-- 공연 장소: 카카오 장소 검색 결과(주소·좌표) — 예매 페이지 지도 표시용
alter table public.events add column if not exists venue_address text;
alter table public.events add column if not exists venue_lat double precision;
alter table public.events add column if not exists venue_lng double precision;

-- 팀 소개는 공개 정보 — PII(kakao_id, contact_phone, bank_info) 없는 공개 뷰로만 노출.
-- event_hosts 테이블 자체는 여전히 anon 정책 없음(전면 차단).
create or replace view public.event_host_profiles as
  select id, name, bio, sns from public.event_hosts;
grant select on public.event_host_profiles to anon, authenticated, service_role;
