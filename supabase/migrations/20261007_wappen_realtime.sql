-- ═══════════════ 와펜 꾸미기 — 라이브 갱신용 Realtime 발행 (2026-10-07) ═══════════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (선택 사항 — 실행하지 않아도 화면은 탭 복귀·25초 주기 폴링으로 갱신된다)
--
-- wappen/app.js 가 anon 키로 supabase_realtime 발행의 postgres_changes 를 구독한다.
-- anon 은 RLS 에 따라 active 행의 변경만 받는다(wappen_projects/works/items 의 public_read 정책).
-- 반응은 wappen_reactions 에 anon 정책이 없어 이벤트가 오지 않지만, 트리거가 wappen_works.reaction_count 를
-- 갱신하면서 wappen_works UPDATE 이벤트가 오므로 작품 화면의 반응 수도 라이브로 바뀐다.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime 발행이 없습니다 — 대시보드 Database → Replication 에서 테이블을 켜주세요';
    return;
  end if;
  foreach t in array array['wappen_projects', 'wappen_works', 'wappen_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
