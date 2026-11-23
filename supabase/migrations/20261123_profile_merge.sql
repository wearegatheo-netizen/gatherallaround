-- 게더링 멤버 계정 통합(2026-11-23) — 같은 사람이 이메일 가입 + 카카오 가입으로 두 계정을 가진 경우 하나로 합친다.
-- 관리자 › 멤버 목록의 [통합] 버튼 → /gatheo-api {action:'profile_merge'}(운영 총괄만) → 이 함수(service role 만 실행 가능).
-- 함수 하나가 한 트랜잭션이라, 중간에 실패하면 아무것도 바뀌지 않는다. 여러 번 실행해도 안전(create or replace).
--
-- p_keep = 남길 프로필 id, p_drop = 없앨 프로필 id.
--   · 없앨 쪽에 이메일 로그인 계정(auth.users)이 있으면 거부(MERGE_DROP_HAS_LOGIN) — 그 로그인이 갈 곳을 잃는다.
--   · 남는 쪽에 카카오 ID 가 없으면 없앨 쪽 것을 물려받는다(= 카카오 로그인 연결).
--   · 프로필 id 로 남긴 기록(일정 신청·외부인 줄·투표·예약 참여 멤버·팀 구성·일정표 팀 멤버)을 남는 쪽으로 옮긴다
--     (같은 슬롯·같은 투표에 둘 다 있으면 남는 쪽 것을 남김).
--   · 예약·게시글·투표 작성자 키(kakao_id / created_by)를 남는 계정의 기록 키(카카오 ID, 없으면 계정 id)로 통일한다.
--   · 역할·상태는 남는 쪽 그대로, 남는 쪽에 비어 있는 연락처·세션·음악 취향·프로필 사진·이메일만 없앨 쪽 값으로 채운다.
create or replace function public.gaa_merge_profiles(p_keep text, p_drop text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k record; d record;
  kj jsonb; dj jsonb;
  new_kakao text; canon text; old text; stmt text; col record;
  n int; moved jsonb := '{}'::jsonb;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'MERGE_SAME'; end if;
  select * into k from public.profiles where id::text = p_keep for update;
  if not found then raise exception 'MERGE_NOT_FOUND'; end if;
  select * into d from public.profiles where id::text = p_drop for update;
  if not found then raise exception 'MERGE_NOT_FOUND'; end if;
  kj := to_jsonb(k); dj := to_jsonb(d);
  if coalesce(kj->>'member_type', '') = 'band' or coalesce(dj->>'member_type', '') = 'band' then raise exception 'MERGE_BAND'; end if;
  if exists (select 1 from auth.users u where u.id::text = p_drop) then raise exception 'MERGE_DROP_HAS_LOGIN'; end if;

  new_kakao := coalesce(nullif(kj->>'kakao_id', ''), nullif(dj->>'kakao_id', ''));
  canon := coalesce(new_kakao, p_keep);   -- 남는 계정의 기록 키

  -- 1) 프로필 id 로 남긴 기록
  if to_regclass('public.schedule_attendees') is not null then
    execute format('delete from public.schedule_attendees a where a.profile_id::text = %L and exists (select 1 from public.schedule_attendees b where b.profile_id::text = %L and b.schedule_date = a.schedule_date and b.group_name is not distinct from a.group_name)', p_drop, p_keep);
    execute format('update public.schedule_attendees set profile_id = %L where profile_id::text = %L', p_keep, p_drop);
    get diagnostics n = row_count; moved := moved || jsonb_build_object('attendees', n);
  end if;
  if to_regclass('public.schedule_guests') is not null then
    execute format('delete from public.schedule_guests a where a.host_profile_id::text = %L and exists (select 1 from public.schedule_guests b where b.host_profile_id::text = %L and b.schedule_date = a.schedule_date and b.slot_key = a.slot_key)', p_drop, p_keep);
    execute format('update public.schedule_guests set host_profile_id = %L where host_profile_id::text = %L', p_keep, p_drop);
    get diagnostics n = row_count; moved := moved || jsonb_build_object('guests', n);
  end if;
  if to_regclass('public.poll_votes') is not null then
    execute format('delete from public.poll_votes a where a.voter_id::text = %L and exists (select 1 from public.poll_votes b where b.voter_id::text = %L and b.poll_id = a.poll_id)', p_drop, p_keep);
    execute format('update public.poll_votes set voter_id = %L where voter_id::text = %L', p_keep, p_drop);
    get diagnostics n = row_count; moved := moved || jsonb_build_object('votes', n);
  end if;
  -- 예약 참여 멤버(배열/JSON)·팀 구성·일정표 팀 멤버: 값 안에 든 프로필 id 를 바꾼다(컬럼 타입에 맞춰 되돌려 넣는다)
  n := 0;
  for stmt in
    select format('update public.%I set %I = replace(%I::text, %L, %L)::%s where %I::text like %L',
                  c.table_name, c.column_name, c.column_name, p_drop, p_keep,
                  case when c.data_type = 'ARRAY' then format('%I[]', substr(c.udt_name, 2)) else c.udt_name end,
                  c.column_name, '%' || p_drop || '%')
      from information_schema.columns c
     where c.table_schema = 'public'
       and (c.table_name, c.column_name) in (('reservations', 'participant_ids'), ('teams', 'members'), ('schedules', 'members'))
  loop
    execute stmt;
    get diagnostics n = row_count; moved := moved || jsonb_build_object('lists', coalesce((moved->>'lists')::int, 0) + n);
  end loop;

  -- 2) 작성자 키 통일: 두 계정이 써 온 키(각자의 카카오 ID·계정 id) → 남는 계정의 기록 키
  foreach old in array array[nullif(dj->>'kakao_id', ''), p_drop, p_keep, nullif(kj->>'kakao_id', '')] loop
    if old is null or old = canon then continue; end if;
    if to_regclass('public.reservations') is not null then
      execute format('update public.reservations set kakao_id = %L where kakao_id::text = %L', canon, old);
      get diagnostics n = row_count; moved := moved || jsonb_build_object('reservations', coalesce((moved->>'reservations')::int, 0) + n);
    end if;
    if to_regclass('public.comments') is not null then
      execute format('update public.comments set kakao_id = %L where kakao_id::text = %L', canon, old);
      get diagnostics n = row_count; moved := moved || jsonb_build_object('comments', coalesce((moved->>'comments')::int, 0) + n);
    end if;
    if to_regclass('public.polls') is not null then
      execute format('update public.polls set created_by = %L where created_by::text = %L', canon, old);
    end if;
  end loop;

  -- 3) 없앨 프로필 삭제 → 남는 프로필에 카카오 ID · 빈 칸 채우기
  delete from public.profiles where id::text = p_drop;
  if new_kakao is not null and nullif(kj->>'kakao_id', '') is null then
    execute format('update public.profiles set kakao_id = %L where id::text = %L', new_kakao, p_keep);
  end if;
  for col in
    select c.column_name, c.udt_name from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'profiles'
       and c.column_name in ('phone', 'instruments', 'music_taste', 'avatar_url', 'email')
  loop
    if nullif(dj->>col.column_name, '') is not null and nullif(kj->>col.column_name, '') is null then
      execute format('update public.profiles set %I = %L where id::text = %L', col.column_name,
                     case when col.udt_name in ('json', 'jsonb') then (dj->col.column_name)::text else dj->>col.column_name end, p_keep);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'keep', p_keep, 'kakao_linked', new_kakao is not null, 'moved', moved);
end $$;

-- 서버 함수(service role)만 실행할 수 있게 — 공개 키로는 못 부른다
revoke all on function public.gaa_merge_profiles(text, text) from public;
revoke all on function public.gaa_merge_profiles(text, text) from anon, authenticated;
grant execute on function public.gaa_merge_profiles(text, text) to service_role;
