-- ═══════════ 포스터 꾸미기: 프로젝트 ↔ 공연 연결 — 2026-10-20 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20261020_ticket_transfer 와 순서 무관)
--
-- 프로젝트(포스터)에 공연 예매의 공연(events)을 하나 연결한다. 프로젝트·작품 페이지와 공유 OG 에 공연 정보와
-- [예매하러 가기](/show/<id>) 가 붙고, 공연 상세에는 연결된 포스터 꾸미기 프로젝트가 보인다.
-- anon 읽기는 PostgREST 임베드 `wappen_projects(…, events(…))` — events 의 RLS(status <> 'hidden') 가 그대로 적용된다.
-- 쓰기는 wappen-api(project_create/project_update 의 event_id, 공개 공연만 허용).

alter table public.wappen_projects add column if not exists event_id uuid references public.events(id) on delete set null;
create index if not exists wappen_projects_event_idx on public.wappen_projects (event_id);
