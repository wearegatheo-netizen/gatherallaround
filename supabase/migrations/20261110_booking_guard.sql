-- ═══════════ 예약 이중 등록 방지 (DB 잠금) — 2026-11-10 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. 여러 번 실행해도 안전.
--
-- 배경: 게더링 예약(reservations)·공간 대관(performance_bookings)의 겹침 검사가 브라우저에만 있어
--       두 사람이 동시에 누르면 같은 시간에 둘 다 들어갈 수 있었다.
-- 방식: INSERT 직전 트리거가 날짜 단위 잠금(pg_advisory_xact_lock)을 잡고 겹침을 확인한다 → 겹치면 'SLOT_TAKEN' 오류.
--       · 겹침 기준은 화면과 동일: 게더링 예약(거절·취소 제외) + 대관(확정 + 4시간 안 지난 입금 대기), 시간은 시작 슬롯 기준(양 끝 포함).
--       · 차단 시간(time_blocks)은 반복·건너뛰기 규칙이 복잡해 여기서 보지 않는다(화면이 계속 검사).
--       · 검사 자체가 실패하면(예: 형식이 다른 옛 행) 예약을 막지 않고 통과시킨다(fail-open).
--       · 수정(UPDATE)에는 적용하지 않는다 — 관리자 예약 수정은 화면 검사 그대로.

create or replace function public.gaa_slot_conflict(p_date text, p_start text, p_end text)
returns boolean
language sql volatile security definer
set search_path = public
as $$
  select exists (
           select 1 from public.reservations r
            where r.res_date::text = p_date
              and coalesce(r.status::text, '') not in ('rejected', 'cancelled')
              and r.start_time::text::time <= p_end::time
              and r.end_time::text::time   >= p_start::time)
      or exists (
           select 1 from public.performance_bookings b
            where b.date::text = p_date
              and (b.status::text = 'approved'
                   or (b.status::text = 'pending' and b.created_at > now() - interval '4 hours'))
              and b.start_time::text::time <= p_end::time
              and b.end_time::text::time   >= p_start::time);
$$;
revoke all on function public.gaa_slot_conflict(text, text, text) from public, anon, authenticated;

create or replace function public.gaa_reservation_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(NEW.status::text, '') in ('rejected', 'cancelled') then return NEW; end if;
  begin
    perform pg_advisory_xact_lock(hashtext('gaa-slot:' || NEW.res_date::text));
    if public.gaa_slot_conflict(NEW.res_date::text, NEW.start_time::text, NEW.end_time::text) then
      raise exception 'SLOT_TAKEN' using errcode = 'GA001';
    end if;
  exception
    when sqlstate 'GA001' then raise;
    when others then null;   -- 검사 실패는 통과
  end;
  return NEW;
end;
$$;

create or replace function public.gaa_perf_booking_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(NEW.status::text, 'pending') not in ('pending', 'approved') then return NEW; end if;
  begin
    perform pg_advisory_xact_lock(hashtext('gaa-slot:' || NEW.date::text));
    if public.gaa_slot_conflict(NEW.date::text, NEW.start_time::text, NEW.end_time::text) then
      raise exception 'SLOT_TAKEN' using errcode = 'GA001';
    end if;
  exception
    when sqlstate 'GA001' then raise;
    when others then null;
  end;
  return NEW;
end;
$$;

drop trigger if exists gaa_reservation_guard on public.reservations;
create trigger gaa_reservation_guard before insert on public.reservations
  for each row execute function public.gaa_reservation_guard();

drop trigger if exists gaa_perf_booking_guard on public.performance_bookings;
create trigger gaa_perf_booking_guard before insert on public.performance_bookings
  for each row execute function public.gaa_perf_booking_guard();

-- 확인: select tgname from pg_trigger where tgname in ('gaa_reservation_guard','gaa_perf_booking_guard');   → 2행
-- 되돌리기:
--   drop trigger if exists gaa_reservation_guard on public.reservations;
--   drop trigger if exists gaa_perf_booking_guard on public.performance_bookings;
