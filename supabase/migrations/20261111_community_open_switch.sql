-- 커뮤니티 모임을 「상시 모집」으로 전환(2026-11-11): 수정 화면에서 날짜·시간을 해지할 수 있게
-- community_update_meeting 이 p_patch 의 "open_ended": true 를 받으면
--   ① 그 모임이 공간 시간표에 잡아 둔 1회 차단([커뮤니티] 제목 · 그 날짜)을 지우고
--   ② meeting_date / meeting_time 을 비운다.
-- 나머지 동작은 종전과 같다. 여러 번 실행해도 안전.
alter table public.community_meetings alter column meeting_date drop not null;
alter table public.community_meetings alter column meeting_time drop not null;

create or replace function public.community_update_meeting(p_id uuid, p_pw text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_open boolean := coalesce((p_patch->>'open_ended')::boolean, false);
  v_title text;
  v_date  date;
begin
  if not community_can_edit(p_id, p_pw) then raise exception 'FORBIDDEN'; end if;
  if v_open then
    select title, meeting_date into v_title, v_date from public.community_meetings where id = p_id;
    if v_date is not null then
      begin
        delete from public.time_blocks
         where reason = '[커뮤니티] ' || v_title and start_date = v_date and end_date = v_date;
      exception when others then null;  -- 시간표 정리 실패가 전환을 막지 않게
      end;
    end if;
  end if;
  update public.community_meetings set
    title                = case when p_patch ? 'title'                then p_patch->>'title'                else title end,
    cover_image_url      = case when p_patch ? 'cover_image_url'      then p_patch->>'cover_image_url'      else cover_image_url end,
    location             = case when p_patch ? 'location'             then p_patch->>'location'             else location end,
    organizer_name       = case when p_patch ? 'organizer_name'       then p_patch->>'organizer_name'       else organizer_name end,
    organizer_phone      = case when p_patch ? 'organizer_phone'      then p_patch->>'organizer_phone'      else organizer_phone end,
    organizer_email      = case when p_patch ? 'organizer_email'      then p_patch->>'organizer_email'      else organizer_email end,
    fee                  = case when p_patch ? 'fee'                  then p_patch->>'fee'                  else fee end,
    items_to_bring       = case when p_patch ? 'items_to_bring'       then p_patch->>'items_to_bring'       else items_to_bring end,
    description          = case when p_patch ? 'description'          then p_patch->>'description'          else description end,
    capacity             = case when p_patch ? 'capacity'             then (p_patch->>'capacity')::int      else capacity end,
    application_deadline = case when p_patch ? 'application_deadline' then (p_patch->>'application_deadline')::date else application_deadline end,
    is_closed            = case when p_patch ? 'is_closed'            then (p_patch->>'is_closed')::boolean else is_closed end,
    form_fields          = case when p_patch ? 'form_fields'          then p_patch->'form_fields'           else form_fields end,
    meeting_date         = case when v_open then null else meeting_date end,
    meeting_time         = case when v_open then null else meeting_time end
  where id = p_id;
end; $$;

grant execute on function public.community_update_meeting(uuid, text, jsonb) to anon, authenticated;
