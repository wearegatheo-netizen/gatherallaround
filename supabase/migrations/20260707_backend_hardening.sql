-- ============================================================================
-- 백엔드 하드닝 마이그레이션 (2026-07-07)
-- Supabase SQL Editor 에서 순서대로 실행. 기존 정책/스키마와 충돌하면 검토 후 조정.
-- (가능한 한 IF NOT EXISTS / idempotent)
--
-- 포함 항목: 1) 도어락 안내문 이전(documents), 4) 커뮤니티 PW 서버검증 RPC,
--            7) 브루트포스 완화용 auth_attempts
-- (항목 5 밴드관리자는 DB 변경 없이 클라 isBandAdmin 이 '게더링 로그인 아이디'로 판정)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 도어락/Wi-Fi/연락처 안내문 템플릿을 소스에서 분리 → app_settings 로 이전
--    ⚠️ 기존 'documents' 테이블은 앱의 자료실 기능이 이미 사용 중(id/category/title...)
--       이라 재사용 불가 → 전용 테이블 app_settings(key/value) 를 새로 만든다.
--    클라이언트 generateApprovalMessage() 가 key='perf_approval_template' 을 읽음.
--    관리자만 읽도록 RLS 로 보호.
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  content    text,
  updated_at timestamptz default now()
);

-- 기존 안내문(도어락 코드 포함)을 seed. 플레이스홀더: {DATE} {START} {END} {HOURS}
insert into public.app_settings (key, content) values (
  'perf_approval_template',
  E'안녕하세요! 신촌 게더 올 어라운드입니다.\n{DATE} {START}~{END}({HOURS}시간) 예약이 확인되었습니다.\n아래 안내사항을 꼭 확인해 주시고, 확인 후 답변주시면 감사하겠습니다!! 😊\n\n📍 기본 정보\n주소: 서울시 서대문구 연세로5나길 33 지하 1층\n출입방법: [1층 현관] 0815 [지하 1층] 20251220\nWi-Fi: 거울측 선반 2번째 칸 공유기 확인\n\n💬 이용 시 주의사항\n장비 보호: 악기, 장비, 물품 파손 시 100% 본인 과실로 변상하셔야 합니다.\n화기 금지 / 음식물 취식 후 정리 철저 / 사용 물품 원상 복구 / 금연 및 매너 유지 / 퇴실 시 소등·문단속 확인\n\n💬 시설 이용법 및 세팅\n🎹 음향 및 장비 상세 매뉴얼: https://docs.google.com/presentation/d/1k9r6Dlt9TKcI1rcwLl3g0ggCvJVaRm7XFf0LLqEbJT0/edit?usp=sharing\n❄️ 냉난방기: 리모컨 사용 (에어컨/히터 모두 구비)\n📽️ 빔프로젝터: HDMI 연결 후 리모컨으로 전원 ON\n\n☎️ 문의처: 010-5109-1042 (최경수) / 010-2357-2040 (장한영)'
) on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- 관리자(운영 총괄/총괄/세션장)만 SELECT. 프로젝트의 role 값에 맞게 조정.
drop policy if exists app_settings_admin_read on public.app_settings;
create policy app_settings_admin_read on public.app_settings
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('운영 총괄', '총괄', '세션장')
    )
  );

-- 쓰기(템플릿 수정)도 관리자만
drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('운영 총괄', '총괄')
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('운영 총괄', '총괄')
    )
  );

-- ⚠️ 배포 후 반드시: 실제 도어락 번호를 변경하세요.
--    (이 코드들은 이미 공개 GitHub 히스토리/배포 소스에 노출된 적이 있음)
--    새 번호는 이 documents 행에만 반영하고 소스에는 커밋하지 마세요.

-- ----------------------------------------------------------------------------
-- 4) 커뮤니티 모임 수정/삭제 서버 강제 (권장 후속)
--    주최자는 로그인 사용자가 아니라 "모임별 비밀번호"로 인증하므로 RLS 만으로는
--    막을 수 없음 → 비밀번호를 서버에서 검증하는 SECURITY DEFINER RPC 로 수정/삭제.
--
--    verify-meeting-password Edge Function 과 동일한 해시 규칙(SHA-256(pw+salt)).
--    컬럼명(password_hash/password_salt) 이 실제와 일치하는지 확인 후 사용.
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

create or replace function public.community_verify_pw(p_id uuid, p_pw text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_salt text;
begin
  select password_hash, password_salt into v_hash, v_salt
    from public.community_meetings where id = p_id;
  if v_hash is null then return false; end if;
  return encode(digest(p_pw || v_salt, 'sha256'), 'hex') = v_hash;
end;
$$;

-- 이후(권장): 수정/삭제 RPC 를 만들어 community_verify_pw 로 검증 후 update/delete,
--   그리고 community_meetings 의 익명 update/delete 정책을 제거해 반드시 RPC 를 거치게.
--   (클라 rewrite 는 후속 작업 — 런북 '남은 후속 작업' 참고)

-- ----------------------------------------------------------------------------
-- 7) 커뮤니티 마스터 PW 브루트포스 완화용 시도 로그 테이블
--    verify-community-admin Edge Function 이 IP별 최근 시도 수를 세어 429 로 제한.
-- ----------------------------------------------------------------------------
create table if not exists public.auth_attempts (
  id         bigint generated always as identity primary key,
  scope      text not null,          -- 예: 'community-master'
  ip         text,
  created_at timestamptz default now()
);
create index if not exists auth_attempts_scope_ip_time
  on public.auth_attempts (scope, ip, created_at desc);
-- 서비스 롤에서만 접근(RLS 활성화로 익명 차단). Edge Function 은 service_role 로 접근.
alter table public.auth_attempts enable row level security;

-- (선택) 오래된 시도 로그 정리
-- delete from public.auth_attempts where created_at < now() - interval '1 day';
