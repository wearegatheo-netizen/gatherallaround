-- ═══════════ 게더링 일정표: 슬롯 정원(참여 인원 제한) — 2026-11-17 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. 여러 번 실행해도 안전.
--
-- 일정 편집기에서 시간(슬롯)마다 「정원」을 적으면 그 인원까지만 신청을 받는다. 비우면(null) 제한 없음.
-- 세는 것: 그 슬롯의 멤버 신청(schedule_attendees — 개인 신청·팀으로 신청 모두 같은 행) + 외부인(schedule_guests.guest_count 합).
-- 화면도 신청 직전에 확인하지만, 신청 시작 시각에 여러 명이 동시에 누르면 화면 검사만으로는 정원을 넘을 수 있어
-- INSERT 직전 트리거가 슬롯 단위 잠금(pg_advisory_xact_lock)을 잡고 다시 센다 → 넘으면 'SLOT_FULL' 오류.
--   · 슬롯 키는 화면 slotAttKey 와 같다: 'slot|<그룹 이름>|<시작 시각>'.
--   · 팀으로 신청(여러 행 한 번에)은 중간에 정원을 넘으면 전체가 취소된다(일부만 들어가지 않음).
--   · 취소(DELETE)·정원 없는 슬롯은 건드리지 않는다. 검사 자체가 실패하면 신청을 막지 않는다(fail-open).

alter table public.schedules add column if not exists capacity integer;

create or replace function public.gaa_slot_capacity(p_date text, p_key text)
returns integer
language sql stable security definer
set search_path = public
as $$
  select max(s.capacity) from public.schedules s
   where s.date::text = p_date
     and s.capacity is not null and s.capacity > 0
     and 'slot|' || coalesce(s.group_name, '') || '|' || coalesce(s.start_time::text, '') = p_key;
$$;

create or replace function public.gaa_slot_used(p_date text, p_key text, p_skip_guest uuid default null)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare n integer := 0; g integer := 0;
begin
  select count(distinct a.profile_id) into n from public.schedule_attendees a
   where a.schedule_date::text = p_date and a.group_name = p_key;
  begin
    select coalesce(sum(x.guest_count), 0) into g from public.schedule_guests x
     where x.schedule_date::text = p_date and x.slot_key = p_key
       and (p_skip_guest is null or x.id <> p_skip_guest);
  exception when undefined_table then g := 0;   -- 외부인 표가 아직 없으면 0
  end;
  return n + g;
end;
$$;
revoke all on function public.gaa_slot_capacity(text, text) from public, anon, authenticated;
revoke all on function public.gaa_slot_used(text, text, uuid) from public, anon, authenticated;

-- 멤버 신청(개인·팀)
create or replace function public.gaa_attendee_capacity_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare cap integer;
begin
  if NEW.group_name is null or NEW.group_name not like 'slot|%' then return NEW; end if;
  begin
    perform pg_advisory_xact_lock(hashtext('gaa-cap:' || NEW.schedule_date::text || ':' || NEW.group_name));
    cap := public.gaa_slot_capacity(NEW.schedule_date::text, NEW.group_name);
    if cap is not null then
      -- 이미 신청돼 있는 사람의 같은 슬롯 행은 자리를 더 쓰지 않는다
      if not exists (select 1 from public.schedule_attendees a
                      where a.schedule_date = NEW.schedule_date and a.group_name = NEW.group_name and a.profile_id = NEW.profile_id)
         and public.gaa_slot_used(NEW.schedule_date::text, NEW.group_name) >= cap then
        raise exception 'SLOT_FULL' using errcode = 'GA002';
      end if;
    end if;
  exception
    when sqlstate 'GA002' then raise;
    when others then null;   -- 검사 실패는 통과
  end;
  return NEW;
end;
$$;

drop trigger if exists gaa_attendee_capacity_guard on public.schedule_attendees;
create trigger gaa_attendee_capacity_guard before insert on public.schedule_attendees
  for each row execute function public.gaa_attendee_capacity_guard();

-- 외부인 신청(새 줄·인원 늘리기). 인원을 줄이는 수정은 언제나 통과.
create or replace function public.gaa_guest_capacity_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare cap integer;
begin
  if TG_OP = 'UPDATE' and NEW.schedule_date = OLD.schedule_date and NEW.slot_key = OLD.slot_key
     and NEW.guest_count <= OLD.guest_count then return NEW; end if;
  begin
    perform pg_advisory_xact_lock(hashtext('gaa-cap:' || NEW.schedule_date::text || ':' || NEW.slot_key));
    cap := public.gaa_slot_capacity(NEW.schedule_date::text, NEW.slot_key);
    if cap is not null
       and public.gaa_slot_used(NEW.schedule_date::text, NEW.slot_key, NEW.id) + NEW.guest_count > cap then
      raise exception 'SLOT_FULL' using errcode = 'GA002';
    end if;
  exception
    when sqlstate 'GA002' then raise;
    when others then null;
  end;
  return NEW;
end;
$$;

do $$ begin
  if to_regclass('public.schedule_guests') is not null then
    drop trigger if exists gaa_guest_capacity_guard on public.schedule_guests;
    create trigger gaa_guest_capacity_guard before insert or update on public.schedule_guests
      for each row execute function public.gaa_guest_capacity_guard();
  end if;
end $$;
