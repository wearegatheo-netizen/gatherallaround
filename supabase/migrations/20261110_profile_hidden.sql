-- ═══════════ 멤버 목록 숨김 표시 — 2026-11-10 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. 여러 번 실행해도 안전.
-- 배경: 멤버 목록에서 숨길 계정(중복·옛 계정)이 코드에 이름으로 박혀 있었다.
--       이제 관리자 › 멤버 정보 수정의 「멤버 목록에서 숨김」 체크로 정한다. 실행 전에는 종전 이름 목록으로 동작.
alter table public.profiles add column if not exists hidden boolean not null default false;
update public.profiles set hidden = true where name in ('최경수(세션장)', '최경수(일반)') and hidden = false;
-- 확인: select name, hidden from public.profiles where hidden;
