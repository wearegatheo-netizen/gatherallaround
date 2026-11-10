-- ═══════════ 게더링·대관 표 잠금: 쓰기는 서버 함수(/gatheo-api)만 — 2026-11-10 ═══════════
-- ⚠️ 순서: 새 사이트(functions/gatheo-api.js 포함)가 **배포되고 정상 동작을 확인한 뒤** 실행한다.
--    실행 전에는 종전처럼 동작하고, 실행 뒤에는 공개 키(anon)로 아래 표를 직접 고칠 수 없다.
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. 여러 번 실행해도 안전.
--
-- 배경: 카카오 로그인 멤버는 DB 입장에서 전부 익명(anon)이라, 승인·차단·공지 같은 관리자 동작과 본인 확인을 DB 가 가릴 수 없었다.
--       (페이지에 들어 있는 공개 키만 있으면 누구나 예약 삭제·역할 변경·연락처 열람 가능)
-- 방식: 아래 표의 기존 정책을 전부 지우고
--   · 쓰기(INSERT/UPDATE/DELETE) 정책 없음 → 서버 함수(service role)만 가능. 서버가 신원(카카오 세션·Supabase 세션)과 역할을 확인한다.
--   · 읽기: profiles 는 본인 행만(authenticated), 나머지는 종전처럼 공개.
--   · performance_bookings 는 달력용 컬럼(id·date·start_time·end_time·status·created_at)만 공개 — 이름·연락처는 서버 함수로만.
-- service role(서버 함수·Edge Function)은 RLS 와 무관하게 동작한다.

do $$
declare t text; r record;
begin
  foreach t in array array['profiles','reservations','time_blocks','performance_bookings','comments','schedule_guests',
                           'schedule_attendees','teams','poll_votes','polls','schedules','documents','notices']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    if t = 'profiles' then
      -- 본인 행만(합주팀·이메일 가입 계정). 다른 정책의 하위 질의(app_settings 등)가 본인 역할을 읽을 수 있게 둔다.
      execute 'create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid())';
    else
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    end if;
  end loop;
end $$;

-- 공간 대관: 달력용 컬럼만 공개
do $$
begin
  if to_regclass('public.performance_bookings') is not null then
    revoke select on public.performance_bookings from anon, authenticated;
    grant select (id, date, start_time, end_time, status, created_at) on public.performance_bookings to anon, authenticated;
  end if;
end $$;

-- 확인(13개 표 모두 rls = true, 정책은 표마다 읽기 1개):
--   select c.relname, c.relrowsecurity as rls,
--          (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname in ('profiles','reservations','time_blocks','performance_bookings','comments','schedule_guests',
--          'schedule_attendees','teams','poll_votes','polls','schedules','documents','notices') order by 1;

-- ── (escape hatch) 화면이 깨지면 아래를 실행해 종전 상태(전부 허용)로 되돌린다 ──────────────────
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['profiles','reservations','time_blocks','performance_bookings','comments','schedule_guests',
--                            'schedule_attendees','teams','poll_votes','polls','schedules','documents','notices']
--   loop
--     if to_regclass('public.' || t) is null then continue; end if;
--     execute format('drop policy if exists %I on public.%I', t || '_open', t);
--     execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t || '_open', t);
--   end loop;
-- end $$;
-- grant select on public.performance_bookings to anon, authenticated;
