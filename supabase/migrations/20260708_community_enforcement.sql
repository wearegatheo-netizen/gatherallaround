-- ============================================================================
-- 커뮤니티 모임 수정/삭제 서버 강제 + 해시 노출 차단 (항목 4 후속, 2026-07-08)
-- 순서대로 실행. STEP C(권한 회수)는 되돌리기 쉬움(맨 아래 escape hatch 참고).
-- 선행: 20260707_backend_hardening.sql (app_settings, pgcrypto) 실행돼 있어야 함.
-- ============================================================================

-- ── STEP A. 검증/수정/삭제 RPC 생성 ────────────────────────────────────────

-- 마스터 비밀번호 해시 저장(평문 아님). '여기에_마스터비번_평문' 을 실제 값으로 바꿔 1회 실행.
insert into public.app_settings (key, content)
values ('community_master_pw_sha256', encode(digest('여기에_마스터비번_평문', 'sha256'), 'hex'))
on conflict (key) do update set content = excluded.content;

-- 모임별 비번(sha256(pw+salt)) 또는 마스터 비번(sha256(pw)) 일치 시 true
create or replace function public.community_can_edit(p_id uuid, p_pw text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_hash text; v_salt text; v_master text;
begin
  select content into v_master from public.app_settings where key = 'community_master_pw_sha256';
  if v_master is not null and encode(digest(p_pw, 'sha256'), 'hex') = v_master then
    return true;
  end if;
  select password_hash, password_salt into v_hash, v_salt
    from public.community_meetings where id = p_id;
  if v_hash is null or v_salt is null then return false; end if;
  return encode(digest(p_pw || v_salt, 'sha256'), 'hex') = v_hash;
end; $$;

-- 수정: 비번 검증 후, 전달된 키만 갱신(없는 키는 기존값 유지). 날짜/시간은 편집 폼에서 안 바꾸므로 제외.
create or replace function public.community_update_meeting(p_id uuid, p_pw text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not community_can_edit(p_id, p_pw) then raise exception 'FORBIDDEN'; end if;
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
    form_fields          = case when p_patch ? 'form_fields'          then p_patch->'form_fields'           else form_fields end
  where id = p_id;
end; $$;

-- 삭제: 비번 검증 후 삭제(신청정보는 FK cascade 로 함께 삭제된다고 가정)
create or replace function public.community_delete_meeting(p_id uuid, p_pw text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not community_can_edit(p_id, p_pw) then raise exception 'FORBIDDEN'; end if;
  delete from public.community_meetings where id = p_id;
end; $$;

grant execute on function public.community_update_meeting(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.community_delete_meeting(uuid, text)       to anon, authenticated;
grant execute on function public.community_can_edit(uuid, text)             to anon, authenticated;

-- ── STEP B. (권한 회수 전에) RPC 동작 테스트 ───────────────────────────────
-- 실제 모임 id + 그 모임 비번으로 아래를 SQL Editor 에서 실행해 검증:
--   select community_can_edit('<meeting-id>', '<맞는 비번>');   -- true 나와야 함
--   select community_can_edit('<meeting-id>', 'wrong');          -- false 나와야 함
--   select community_update_meeting('<meeting-id>', '<맞는 비번>', '{"title":"테스트제목"}'::jsonb);  -- 에러 없이 실행 + 제목 바뀜
-- 위가 모두 정상이면 STEP C 진행.

-- ── STEP C. 직접 수정/삭제 및 해시 컬럼 노출 회수 ──────────────────────────
-- (INSERT/SELECT 는 유지 — 모임 생성/조회는 계속 동작. service_role 은 영향 없음)
revoke update, delete on public.community_meetings from anon, authenticated;
revoke select (password_hash, password_salt) on public.community_meetings from anon, authenticated;

-- ── (escape hatch) 편집이 깨지면 즉시 아래로 원복 ──────────────────────────
--   grant update, delete on public.community_meetings to anon, authenticated;
