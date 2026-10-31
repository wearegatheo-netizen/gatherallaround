-- ═══════════ 게시판 상단 고정 — 2026-10-29 (리더즈 회의: 관리자가 공지성 글을 위로 고정) ═══════════
-- comments.pinned / pinned_at. 고정 글은 화면(renderComments)이 pinned_at 순으로 맨 위에 그린다.
-- 쓰기는 관리자 화면(isAdminUser: 운영 총괄·총괄·세션장)에서 기존 comments UPDATE 정책(좋아요·수정과 같은 경로)으로 한다.
alter table public.comments add column if not exists pinned boolean not null default false;
alter table public.comments add column if not exists pinned_at timestamptz;
create index if not exists comments_pinned_idx on public.comments (pinned) where pinned;
