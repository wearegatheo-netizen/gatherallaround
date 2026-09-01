-- ═══════════ 커뮤니티 모임: 신청 중복 판정 오작동 정리 — 2026-09-02 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20260901 이후)
--
-- 문제: 신청 폼에서 이메일 칸이 제거된 뒤 모든 신청이 applicant_email=''로
-- 저장되는데, (meeting_id, applicant_email) unique 제약이 남아 있어
-- 모임마다 두 번째 신청자부터 전원 "이미 신청하셨습니다"로 차단됐다.
-- 중복 방지는 클라이언트가 연락처(숫자 기준) 대조로 수행하도록 바뀌었으므로
-- 이 테이블의 unique 제약·인덱스를 제거하고, 기존 '' 이메일은 null로 정리한다.
-- (PK는 건드리지 않는다)
-- ※ 이메일은 폼에서 제거된 선택 정보인데 NOT NULL 제약까지 걸려 있어
--    null 저장이 거부된다(23502) — 먼저 해제해야 아래 정리와 신규 신청이 동작한다.

alter table public.community_applications alter column applicant_email drop not null;

update public.community_applications set applicant_email = null where applicant_email = '';

do $$
declare r record;
begin
  -- unique 제약 제거 (contype 'u' — PK 'p'는 제외)
  for r in
    select conname from pg_constraint
    where conrelid = 'public.community_applications'::regclass and contype = 'u'
  loop
    execute format('alter table public.community_applications drop constraint %I', r.conname);
  end loop;
  -- 제약에 딸리지 않은 단독 unique 인덱스도 제거 (PK·제약 인덱스는 위/제외 조건으로 보호)
  for r in
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'community_applications'
      and indexdef ilike 'create unique index%'
      and indexname not in (
        select conname from pg_constraint
        where conrelid = 'public.community_applications'::regclass
      )
  loop
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end $$;
