-- ═══════════ 커뮤니티 신청자 명단 잠금 — 2026-11-10 ═══════════
-- ⚠️ 새 사이트(functions/community-admin.js 의 app_* 액션 포함)가 배포되고 신청·신청 조회가 되는 것을 확인한 뒤 실행.
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. 여러 번 실행해도 안전.
--
-- 배경: community_applications(신청자 이름·연락처·답변)를 공개 키(anon)로 누구나 읽고 지울 수 있었다.
--       모임 상세 화면도 방문자 브라우저로 명단 전체를 내려받고 있었다.
-- 방식: 기존 정책을 전부 지우고 정책을 만들지 않는다 → 서버 함수(service role)만 읽고 쓴다.
--       · 공개 화면: 신청 수와 선택형 답만(이름·연락처 없음)   · 내 신청: 이름+연락처 일치
--       · 전체 명단·수락/거절·삭제: 모임장 비밀번호로 받은 토큰     · 신청 알림 메일(/send-email)은 service role 이라 영향 없음
do $$
declare r record;
begin
  if to_regclass('public.community_applications') is null then return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'community_applications' loop
    execute format('drop policy if exists %I on public.community_applications', r.policyname);
  end loop;
  alter table public.community_applications enable row level security;
end $$;

-- 확인: select count(*) from pg_policies where tablename = 'community_applications';   → 0
--       select relrowsecurity from pg_class where relname = 'community_applications';  → true
-- ── (escape hatch) 신청·조회가 깨지면 아래로 종전 상태(전부 허용)로 되돌린다 ──
--   create policy community_applications_open on public.community_applications
--     for all to anon, authenticated using (true) with check (true);
