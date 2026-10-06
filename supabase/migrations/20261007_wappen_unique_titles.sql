-- ═══════════════ 와펜 꾸미기: 프로젝트·작품 이름 중복 방지 — 2026-10-07 (선택) ═══════════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. 서버 함수(/wappen-api)가 저장 전에 같은 규칙으로 먼저 검사하므로
-- 없어도 동작하지만, 동시에 들어온 두 요청까지 막으려면 이 유일 인덱스가 필요하다 (위반 시 PostgREST 409 → 서버가 dup_title 로 바꿔 응답).
--   규칙(wappen_title_key): 앞뒤 공백·연속 공백·대소문자 무시.  프로젝트는 전체에서, 작품은 같은 프로젝트 안에서 유일.
--   기존 중복은 오래된 행이 이름을 지키고, 나중 행에 " (2)", " (3)" … 를 붙여 먼저 정리한 뒤 인덱스를 만든다.

create or replace function public.wappen_title_key(t text) returns text
language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

do $$
declare r record; n int; cand text;
begin
  for r in
    select p.id, p.title from public.wappen_projects p
    where exists (select 1 from public.wappen_projects q
                  where q.id <> p.id and public.wappen_title_key(q.title) = public.wappen_title_key(p.title) and q.created_at < p.created_at)
    order by p.created_at
  loop
    n := 2;
    loop
      cand := left(r.title, 60 - length(n::text) - 3) || ' (' || n || ')';
      exit when not exists (select 1 from public.wappen_projects where public.wappen_title_key(title) = public.wappen_title_key(cand));
      n := n + 1;
    end loop;
    update public.wappen_projects set title = cand where id = r.id;
  end loop;

  for r in
    select w.id, w.project_id, w.title from public.wappen_works w
    where exists (select 1 from public.wappen_works q
                  where q.id <> w.id and q.project_id = w.project_id and public.wappen_title_key(q.title) = public.wappen_title_key(w.title) and q.created_at < w.created_at)
    order by w.created_at
  loop
    n := 2;
    loop
      cand := left(r.title, 60 - length(n::text) - 3) || ' (' || n || ')';
      exit when not exists (select 1 from public.wappen_works where project_id = r.project_id and public.wappen_title_key(title) = public.wappen_title_key(cand));
      n := n + 1;
    end loop;
    update public.wappen_works set title = cand where id = r.id;
  end loop;
end $$;

create unique index if not exists wappen_projects_title_key_uniq on public.wappen_projects (public.wappen_title_key(title));
create unique index if not exists wappen_works_title_key_uniq    on public.wappen_works (project_id, public.wappen_title_key(title));
