-- ═══════════ 공간 대관: 예약번호(booking_code) — 2026-08-29 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260828 이후)
--
-- 공간 대관 신청마다 6자리 예약번호를 발급한다 (공연 예매번호와 동일 charset —
-- 헷갈리는 I/L/O/0/1 제외). 신청자는 [공간 대관 > 예약 조회]에서
-- 예약번호+연락처로 상태(입금 대기/확정/취소/자동취소)를 확인한다.
-- 자동취소 정책: 신청(pending) 후 4시간 내 승인되지 않으면 취소 — 크론 없이
-- 화면·가용성 계산은 즉시 만료로 취급(lazy)하고, 관리자 탭 진입 시
-- status='expired'로 일괄 반영된다.

alter table public.performance_bookings add column if not exists booking_code text unique;

-- 백필: 기존 행에도 예약번호 발급 (충돌 확률 극히 낮음 — unique 위반으로 실패하면 재실행)
update public.performance_bookings b
set booking_code = (
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '' order by gs)
  from generate_series(1, 6) gs
  where b.id is not null   -- 상관 조건: 행마다 새로 난수 생성
)
where booking_code is null;
