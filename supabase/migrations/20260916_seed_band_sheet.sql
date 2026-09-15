-- ═══════════ 고정 합주팀: 내부운영 시트 데이터 이관 (벤더 · 코드 퍼플 · 아나하) — 2026-09-16 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260915_band_cycles.sql 이후, 여러 번 실행해도 안전)
--
-- 시트 "진행중인 고정팀 / 히스토리" 값을 사이트에 반영한다.
--  · 팀은 band_name_kr 또는 대표자 연락처로 찾는다. 이미 가입한 팀이면 비어 있는 계약 정보만 채우고(기존 값 유지),
--    없으면 로그인 없는 프로필 행을 만든다(현황표·문자 대상에 포함, band_memo '시트 이관').
--    → 그 팀이 나중에 직접 가입하면 이관 행을 삭제하고 새 계정에 계약 정보를 옮길 것.
--  · 납부 기록(시트 '입금' 행)은 그 팀에 납부 행이 하나도 없을 때만 넣는다(구형 행과 중복 방지).
--  · timeslots 컬럼 타입(text[] / jsonb)은 실행 시점에 판별해 맞춘다.
create extension if not exists pgcrypto;

do $$
declare
  v_slot_type text;
  v_slot_cast text;
  v_id uuid;
  v_n int;
begin
  select data_type into v_slot_type from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'timeslots';
  v_slot_cast := case when v_slot_type in ('jsonb', 'json') then v_slot_type else 'text[]' end;

  -- ── 1) 벤더 (Vandor) — 일요일 야간 · 시작 2026-05-17 · 6개월 이상 · 보증금 25만(05-07 입금) · 사용료 25만
  select id into v_id from public.profiles
   where member_type = 'band'
     and (band_name_kr = '벤더' or replace(coalesce(leader_phone, phone, ''), '-', '') = '01074840121')
   order by created_at limit 1;
  if v_id is null then
    v_id := gen_random_uuid();
    execute format($f$
      insert into public.profiles (id, member_type, status, role, name, phone, leader_name, leader_phone,
        band_name_kr, band_name_en, timeslots, band_start_date, band_expected_months,
        band_deposit, band_deposit_paid_at, band_fee, band_memo)
      values (%L, 'band', 'approved', '일반', '권율', '010-7484-0121', '권율', '010-7484-0121',
        '벤더', 'Vandor', %L::%s, '2026-05-17', '6개월 이상', 250000, '2026-05-07', 250000, '시트 이관')$f$,
      v_id, case when v_slot_cast = 'text[]' then '{일_야간}' else '["일_야간"]' end, v_slot_cast);
  else
    update public.profiles set
      band_start_date      = coalesce(band_start_date, '2026-05-17'),
      band_expected_months = coalesce(band_expected_months, '6개월 이상'),
      band_deposit         = coalesce(band_deposit, 250000),
      band_deposit_paid_at = coalesce(band_deposit_paid_at, '2026-05-07'),
      band_fee             = coalesce(band_fee, 250000),
      band_name_en         = coalesce(nullif(band_name_en, ''), 'Vandor')
    where id = v_id;
  end if;
  select count(*) into v_n from public.band_payments where team_id = v_id;
  if v_n = 0 then
    insert into public.band_payments (team_id, paid_at, cycle_no, amount, note) values
      (v_id, '2026-05-17', 0, 250000, '시트 이관'),
      (v_id, '2026-06-08', 1, 250000, '시트 이관'),
      (v_id, '2026-07-07', 2, 250000, '시트 이관'),
      (v_id, '2026-08-07', 3, 250000, '시트 이관'),
      (v_id, '2026-08-30', 4, 250000, '시트 이관');
  end if;

  -- ── 2) 코드 퍼플 (Code Purple) — 히스토리: 일요일 주간 · 등록 2026-04-12 · 12개월 예정(보증금 미입금) · 실사용 4회 · 종료 2026-08-09
  v_id := null;
  select id into v_id from public.profiles
   where member_type = 'band' and (band_name_kr = '코드 퍼플' or band_name_en = 'Code Purple')
   order by created_at limit 1;
  if v_id is null then
    v_id := gen_random_uuid();
    execute format($f$
      insert into public.profiles (id, member_type, status, role, name, phone, leader_name, leader_phone,
        band_name_kr, band_name_en, timeslots, band_start_date, band_expected_months,
        band_deposit, band_deposit_paid_at, band_fee, band_ended_at, band_memo)
      values (%L, 'band', 'rejected', '일반', '고범찬', 'beomchan_koh (인스타)', '고범찬', 'beomchan_koh (인스타)',
        '코드 퍼플', 'Code Purple', %L::%s, '2026-04-12', '12개월', null, null, null, '2026-08-09',
        '시트 이관 · 보증금 미입금 · 실사용 4회 (26/04/12 ~ 26/08/09)')$f$,
      v_id, case when v_slot_cast = 'text[]' then '{일_주간}' else '["일_주간"]' end, v_slot_cast);
  else
    update public.profiles set
      status               = case when status = 'approved' then 'rejected' else status end,
      band_start_date      = coalesce(band_start_date, '2026-04-12'),
      band_expected_months = coalesce(band_expected_months, '12개월'),
      band_ended_at        = coalesce(band_ended_at, '2026-08-09')
    where id = v_id;
  end if;

  -- ── 3) 아나하 — 이미 가입한 계정이 있을 때만 계약 정보 보완 (화·수 야간 · 시작 2026-09-15 · 보증금 20만(09-05 입금))
  --      사용료(band_fee)는 시트에 없어 비워 둔다 → 팀 관리 [계약 정보 수정]에서 입력하면 문자에 금액이 실린다.
  update public.profiles set
    band_start_date      = coalesce(band_start_date, '2026-09-15'),
    band_deposit         = coalesce(band_deposit, 200000),
    band_deposit_paid_at = coalesce(band_deposit_paid_at, '2026-09-05')
  where member_type = 'band'
    and (band_name_kr = '아나하' or replace(coalesce(leader_phone, phone, ''), '-', '') = '01067871995');
end $$;

-- 확인용 (선택): select band_name_kr, status, band_start_date, band_fee, band_ended_at from public.profiles where member_type='band';
