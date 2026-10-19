-- ============================================================================
-- 멤버 프로필 사진 (2026-10-15, 게더링 멤버 페이지 개편)
--   avatar_url : 기본값은 카카오 로그인 때 받은 프로필 사진(클라이언트가 비어 있으면 채움),
--                마이 탭 [사진 바꾸기]로 올린 사진(community-images/avatars/…)으로 교체 가능.
--                NULL 이면 이름 이니셜 아바타.
-- SQL Editor 에서 1회 실행.
-- ============================================================================

alter table public.profiles
  add column if not exists avatar_url text;

-- 확인:
--   select id, name, avatar_url from public.profiles order by created_at desc limit 5;
