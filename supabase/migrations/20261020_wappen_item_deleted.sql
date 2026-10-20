-- 2026-10-20 포스터 꾸미기: 기본 세트 와펜 영구 삭제(묘비 행)
-- 관리자가 기본 세트 와펜을 삭제하면 행을 지우는 대신 status='deleted' 로 남겨, [기본 와펜 세트 불러오기]가 같은 image_url 을
-- "이미 있음"으로 보고 다시 넣지 않게 한다(복원은 관리자 카드 [복원] → status='active'). 공개 조회(RLS status='active')·관리자 목록에서는 보이지 않는다.
-- 미적용 상태에서는 서버가 종전처럼 행을 삭제하고 needs_migration 을 돌려준다(다시 불러오면 돌아옴).
alter table public.wappen_items drop constraint if exists wappen_items_status_check;
alter table public.wappen_items add constraint wappen_items_status_check check (status in ('active', 'hidden', 'deleted'));
