-- 게더링 멤버 계정 삭제(2026-11-24) — ① 멤버 본인의 「회원 탈퇴」 ② 운영 총괄의 「거절된 멤버 삭제」 가 같이 쓰는 DB 함수.
-- /gatheo-api {action:'profile_withdraw' | 'profile_delete'} → 이 함수(service role 만 실행 가능).
-- 함수 하나가 한 트랜잭션이라, 중간에 실패하면 아무것도 바뀌지 않는다. 여러 번 실행해도 안전(create or replace).
--
-- 지우는 것: 프로필(이름·연락처·세션·음악 취향·사진 주소·푸시 구독) · 이메일 로그인 계정 · 앞으로의 예약 ·
--           일정표 신청·외부인 줄 · 투표 응답 · 다른 사람 예약의 참여 멤버 표시 · 팀 구성/일정표 팀 멤버 칸(빈 자리로)
-- 남기되 이름을 지우는 것: 지난 예약(이용 기록) · 게시글·댓글 · 만든 투표 → 작성자 「탈퇴한 멤버」, 작성자 키 비움
-- 합주팀 계정은 대상이 아니다(PROFILE_DELETE_BAND).
create or replace function public.gaa_delete_profile(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record; pj jsonb;
  k text; keys text[];
  today text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  gone text := '탈퇴한 멤버';
  col record; n int; auth_state text := 'none';
  done jsonb := '{}'::jsonb;
begin
  if p_id is null or p_id = '' then raise exception 'PROFILE_DELETE_NOT_FOUND'; end if;
  select * into p from public.profiles where id::text = p_id for update;
  if not found then raise exception 'PROFILE_DELETE_NOT_FOUND'; end if;
  pj := to_jsonb(p);
  if coalesce(pj->>'member_type', '') = 'band' then raise exception 'PROFILE_DELETE_BAND'; end if;
  keys := array_remove(array[p_id, nullif(pj->>'kakao_id', '')], null);   -- 이 사람이 기록에 남긴 작성자 키(계정 id · 카카오 ID)

  -- 1) 프로필 id 로 남긴 것
  if to_regclass('public.schedule_attendees') is not null then
    execute format('delete from public.schedule_attendees where profile_id::text = %L', p_id);
    get diagnostics n = row_count; done := done || jsonb_build_object('attendees', n);
  end if;
  if to_regclass('public.schedule_guests') is not null then
    execute format('delete from public.schedule_guests where host_profile_id::text = %L', p_id);
    get diagnostics n = row_count; done := done || jsonb_build_object('guests', n);
  end if;
  if to_regclass('public.poll_votes') is not null then
    execute format('delete from public.poll_votes where voter_id::text = %L', p_id);
    get diagnostics n = row_count; done := done || jsonb_build_object('votes', n);
  end if;
  -- 다른 사람 예약의 「참여 멤버」에서 빼기(배열이든 JSON 이든)
  for col in
    select c.data_type, c.udt_name from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'reservations' and c.column_name = 'participant_ids'
  loop
    if col.data_type = 'ARRAY' then
      execute format('update public.reservations set participant_ids = array_remove(participant_ids, %L) where participant_ids::text like %L', p_id, '%' || p_id || '%');
    else
      execute format('update public.reservations set participant_ids = (participant_ids::jsonb - %L)::%s where participant_ids::text like %L', p_id, col.udt_name, '%' || p_id || '%');
    end if;
    get diagnostics n = row_count; done := done || jsonb_build_object('participant_lists', n);
  end loop;
  -- 팀 구성 · 일정표 팀 멤버: 그 사람 칸을 빈 자리로(이름 사본도 지움)
  for col in
    select c.table_name, c.udt_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'members' and c.table_name in ('teams', 'schedules')
       and c.udt_name in ('json', 'jsonb')
  loop
    execute format($f$
      update public.%1$I t set members = (
        select coalesce(jsonb_agg(case when e->>'memberId' = %2$L then (e - 'memberName' - 'leader') || '{"memberId": null}'::jsonb else e end), '[]'::jsonb)
          from jsonb_array_elements(t.members::jsonb) e)::%3$s
       where t.members::text like %4$L and jsonb_typeof(t.members::jsonb) = 'array'
    $f$, col.table_name, p_id, col.udt_name, '%' || p_id || '%');
    get diagnostics n = row_count; done := done || jsonb_build_object('members_' || col.table_name, n);
  end loop;

  -- 2) 작성자 키로 남긴 것
  foreach k in array keys loop
    if to_regclass('public.reservations') is not null then
      execute format('delete from public.reservations where kakao_id::text = %L and res_date::text >= %L', k, today);   -- 앞으로의 예약은 취소
      get diagnostics n = row_count; done := done || jsonb_build_object('reservations_cancelled', coalesce((done->>'reservations_cancelled')::int, 0) + n);
      execute format('update public.reservations set kakao_id = %L, user_name = %L where kakao_id::text = %L', '', gone, k); -- 지난 이용 기록은 이름 없이
      get diagnostics n = row_count; done := done || jsonb_build_object('reservations_kept', coalesce((done->>'reservations_kept')::int, 0) + n);
    end if;
    if to_regclass('public.comments') is not null then
      execute format('update public.comments set kakao_id = %L, user_name = %L where kakao_id::text = %L', '', gone, k);
      get diagnostics n = row_count; done := done || jsonb_build_object('comments', coalesce((done->>'comments')::int, 0) + n);
    end if;
    if to_regclass('public.polls') is not null then
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'polls' and column_name = 'creator_name') then
        execute format('update public.polls set created_by = %L, creator_name = %L where created_by::text = %L', '', gone, k);
      else
        execute format('update public.polls set created_by = %L where created_by::text = %L', '', k);
      end if;
    end if;
  end loop;

  -- 3) 프로필 삭제 → 이메일 로그인 계정 삭제(여기서 못 지우면 서버가 관리 API 로 지운다)
  delete from public.profiles where id::text = p_id;
  begin
    delete from auth.users where id::text = p_id;
    get diagnostics n = row_count;
    if n > 0 then auth_state := 'deleted'; end if;
  exception when others then
    auth_state := 'failed';
  end;

  return jsonb_build_object('ok', true, 'id', p_id, 'auth', auth_state, 'done', done);
end $$;

-- 서버 함수(service role)만 실행할 수 있게 — 공개 키로는 못 부른다
revoke all on function public.gaa_delete_profile(text) from public;
revoke all on function public.gaa_delete_profile(text) from anon, authenticated;
grant execute on function public.gaa_delete_profile(text) to service_role;
