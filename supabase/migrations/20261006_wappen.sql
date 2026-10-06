-- ═══════════════ 와펜 꾸미기 (/wappen/) — 2026-10-06 ═══════════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (버킷 insert 가 거부되면 Storage UI 에서 같은 설정으로 생성)
--
-- 설계 원칙:
--   * 쓰기는 전부 Cloudflare Pages Function(/wappen-api, service role)이 수행한다.
--   * 클라이언트(anon)는 공개 상태(active)인 프로젝트·작품·와펜 읽기와 wappen_ranking RPC 호출만 가능.
--   * wappen_users(카카오 ID)·세션·요청·신고·반응(누가 무엇에 반응했는지)에는 anon 정책이 아예 없다
--     (정책 0개 = RLS 전면 차단, service role만 접근).
--   * 작성자 표시명은 events.host_name 과 같은 이유로 프로젝트·작품에 복제(author_name/author_avatar) —
--     wappen_users 가 비공개라 anon 이 join 할 수 없다. 닉네임 변경 시 서버가 두 테이블을 함께 PATCH.
--   * 반응 집계(reaction_count·reaction_counts)는 트리거가 유지 — 클라이언트 read-then-write 금지.

create extension if not exists pgcrypto;

-- 1) 사용자 — 카카오 로그인 즉시 이용(승인 절차 없음). 게더링 profiles 와 완전 분리.
create table if not exists public.wappen_users (
  id            uuid primary key default gen_random_uuid(),
  kakao_id      text unique not null,
  nickname      text not null check (char_length(nickname) between 1 and 20),
  avatar_url    text,
  is_admin      boolean not null default false,
  is_banned     boolean not null default false,
  banned_reason text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
-- 운영 관리자(index.html ADMIN_ID / event-api ADMIN_KAKAO_ID 와 동일) 를 미리 관리자로 등록
insert into public.wappen_users (kakao_id, nickname, is_admin)
  values ('4883868250', '게더링', true)
  on conflict (kakao_id) do update set is_admin = true;

-- 2) 세션 — 카카오 토큰을 매 호출 검증하는 대신 서버가 발급한 토큰(sha256 해시만 저장, 30일)
create table if not exists public.wappen_sessions (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references public.wappen_users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz
);
create index if not exists wappen_sessions_user_idx on public.wappen_sessions (user_id);
create index if not exists wappen_sessions_exp_idx  on public.wappen_sessions (expires_at);

-- 3) 프로젝트 — 기본 이미지 + 사이즈. 누구나(로그인) 생성.
create table if not exists public.wappen_projects (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.wappen_users(id),
  author_name    text not null,              -- 표시용 복제 (wappen_users 비공개)
  author_avatar  text,
  title          text not null check (char_length(title) between 1 and 60),
  description    text check (description is null or char_length(description) <= 500),
  size_key       text not null check (size_key ~ '^[a-z0-9_]{2,24}$'),   -- wappen/presets.js 의 key
  size_group     text not null check (size_group in ('print','sns')),
  orientation    text not null default 'portrait' check (orientation in ('portrait','landscape')),
  width_px       int  not null check (width_px  between 100 and 12000),  -- 업로드된 기본 이미지 실제 px
  height_px      int  not null check (height_px between 100 and 12000),
  base_image_url text not null,
  thumb_url      text,
  works_count    int  not null default 0,
  status         text not null default 'active' check (status in ('active','hidden')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists wappen_projects_list_idx on public.wappen_projects (status, created_at desc);
create index if not exists wappen_projects_pop_idx  on public.wappen_projects (status, works_count desc);
create index if not exists wappen_projects_size_idx on public.wappen_projects (status, size_group, size_key);
create index if not exists wappen_projects_owner_idx on public.wappen_projects (owner_id);

-- 4) 와펜 — 관리자만 등록(PNG, 알파). 작품이 id 로 참조하므로 삭제 대신 숨김.
create table if not exists public.wappen_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  category   text not null check (char_length(category) between 1 and 30),
  tags       text[] not null default '{}' check (cardinality(tags) <= 10),
  image_url  text not null,
  width_px   int not null check (width_px  between 8 and 4000),
  height_px  int not null check (height_px between 8 and 4000),
  sort_order int not null default 0,
  status     text not null default 'active' check (status in ('active','hidden')),
  created_by uuid references public.wappen_users(id),
  created_at timestamptz not null default now()
);
create index if not exists wappen_items_list_idx on public.wappen_items (status, category, sort_order);
create index if not exists wappen_items_tags_idx on public.wappen_items using gin (tags);

-- 5) 작품 — 프로젝트 위에 와펜을 배치한 결과. layout 은 와펜 id·좌표만 담는다(PII 없음).
create table if not exists public.wappen_works (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.wappen_projects(id) on delete cascade,
  author_id       uuid not null references public.wappen_users(id),
  author_name     text not null,
  author_avatar   text,
  title           text not null check (char_length(title) between 1 and 60),
  layout          jsonb not null,
  preview_url     text not null,
  preview_w       int,
  preview_h       int,
  remix_of        uuid references public.wappen_works(id) on delete set null,
  reaction_count  int   not null default 0,
  reaction_counts jsonb not null default '{}'::jsonb,   -- {"love":3,"fire":1,...}
  status          text not null default 'active' check (status in ('active','hidden')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists wappen_works_list_idx    on public.wappen_works (status, created_at desc);
create index if not exists wappen_works_project_idx on public.wappen_works (project_id, status, reaction_count desc);
create index if not exists wappen_works_pop_idx     on public.wappen_works (status, reaction_count desc);
create index if not exists wappen_works_author_idx  on public.wappen_works (author_id);

-- 6) 반응 — 작품당 1인 1개 (종류 변경 = upsert, 취소 = delete)
create table if not exists public.wappen_reactions (
  work_id    uuid not null references public.wappen_works(id) on delete cascade,
  user_id    uuid not null references public.wappen_users(id) on delete cascade,
  kind       text not null check (kind in ('love','cool','lol','wow','fire')),
  created_at timestamptz not null default now(),
  primary key (work_id, user_id)
);
create index if not exists wappen_reactions_recent_idx on public.wappen_reactions (created_at desc);
create index if not exists wappen_reactions_user_idx   on public.wappen_reactions (user_id);

-- 7) 와펜 추가 요청 — 일반 사용자 → 관리자
create table if not exists public.wappen_item_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.wappen_users(id),
  name          text not null check (char_length(name) between 1 and 40),
  description   text check (description is null or char_length(description) <= 500),
  ref_image_url text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note    text,
  item_id       uuid references public.wappen_items(id) on delete set null,
  resolved_by   uuid references public.wappen_users(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists wappen_item_requests_idx on public.wappen_item_requests (status, created_at desc);
create index if not exists wappen_item_requests_user_idx on public.wappen_item_requests (user_id);

-- 8) 신고 — 작품/프로젝트. 같은 사람이 같은 대상을 중복 신고 불가.
create table if not exists public.wappen_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.wappen_users(id),
  target_type text not null check (target_type in ('work','project')),
  target_id   uuid not null,
  reason      text not null check (reason in ('sexual','violence','copyright','spam','other')),
  detail      text check (detail is null or char_length(detail) <= 300),
  status      text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid references public.wappen_users(id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index if not exists wappen_reports_idx on public.wappen_reports (status, created_at desc);

-- 9) 집계 트리거 — 반응 수(총·종류별), 프로젝트 작품 수(active 만)
create or replace function public.wappen_reactions_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_work uuid := coalesce(new.work_id, old.work_id);
begin
  update wappen_works w set
    reaction_count  = (select count(*) from wappen_reactions r where r.work_id = v_work),
    reaction_counts = coalesce((select jsonb_object_agg(t.kind, t.c)
                                from (select kind, count(*) c from wappen_reactions where work_id = v_work group by kind) t),
                               '{}'::jsonb)
  where w.id = v_work;
  return null;
end $$;
drop trigger if exists wappen_reactions_sync_t on public.wappen_reactions;
create trigger wappen_reactions_sync_t
  after insert or update or delete on public.wappen_reactions
  for each row execute function public.wappen_reactions_sync();

create or replace function public.wappen_works_count_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update wappen_projects p set works_count =
    (select count(*) from wappen_works w where w.project_id = p.id and w.status = 'active')
  where p.id in (new.project_id, old.project_id);
  return null;
end $$;
drop trigger if exists wappen_works_count_t on public.wappen_works;
create trigger wappen_works_count_t
  after insert or update of status or delete on public.wappen_works
  for each row execute function public.wappen_works_count_sync();

-- 10) 랭킹 RPC — anon 호출 가능. p_period: 'week'(최근 7일 반응 수) | 'all'(누적).
--     p_size_key: null/'' 전체, 'print'|'sns' 그룹, 그 외 개별 size_key.
--     definer 로 두어 차단 사용자(wappen_users 비공개) 작품을 제외할 수 있게 한다.
create or replace function public.wappen_ranking(p_period text, p_size_key text default null, p_limit int default 50)
returns table (
  rank int, id uuid, title text, preview_url text, preview_w int, preview_h int,
  author_name text, author_avatar text, project_id uuid, project_title text,
  size_key text, orientation text, score bigint, total int
)
language sql security definer set search_path = public stable as $$
  with scored as (
    select w.id, w.title, w.preview_url, w.preview_w, w.preview_h, w.author_name, w.author_avatar,
           p.id as project_id, p.title as project_title, p.size_key, p.orientation, w.reaction_count as total,
           case when p_period = 'week'
                then (select count(*) from wappen_reactions r
                      where r.work_id = w.id and r.created_at >= now() - interval '7 days')
                else w.reaction_count::bigint end as score
    from wappen_works w
    join wappen_projects p on p.id = w.project_id and p.status = 'active'
    join wappen_users   u on u.id = w.author_id and not u.is_banned
    where w.status = 'active'
      and (p_size_key is null or p_size_key = ''
           or (p_size_key in ('print','sns') and p.size_group = p_size_key)
           or p.size_key = p_size_key)
  )
  select row_number() over (order by s.score desc, s.total desc, s.id)::int as rank,
         s.id, s.title, s.preview_url, s.preview_w, s.preview_h, s.author_name, s.author_avatar,
         s.project_id, s.project_title, s.size_key, s.orientation, s.score, s.total
  from scored s
  where s.score > 0
  order by s.score desc, s.total desc, s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
grant execute on function public.wappen_ranking(text, text, int) to anon, authenticated, service_role;

-- 11) RLS
alter table public.wappen_users         enable row level security;  -- 정책 없음 = anon/auth 전면 차단
alter table public.wappen_sessions      enable row level security;  -- 정책 없음
alter table public.wappen_reactions     enable row level security;  -- 정책 없음 (집계는 works.reaction_counts)
alter table public.wappen_item_requests enable row level security;  -- 정책 없음
alter table public.wappen_reports       enable row level security;  -- 정책 없음
alter table public.wappen_projects      enable row level security;
alter table public.wappen_works         enable row level security;
alter table public.wappen_items         enable row level security;
drop policy if exists wappen_projects_public_read on public.wappen_projects;
create policy wappen_projects_public_read on public.wappen_projects for select using (status = 'active');
drop policy if exists wappen_works_public_read on public.wappen_works;
create policy wappen_works_public_read on public.wappen_works for select using (status = 'active');
drop policy if exists wappen_items_public_read on public.wappen_items;
create policy wappen_items_public_read on public.wappen_items for select using (status = 'active');
-- insert/update/delete 정책 없음 → 클라이언트 쓰기 불가 (service role 만)

-- 12) 스토리지 — 공개 읽기 버킷. 업로드는 /wappen-api 가 발급한 서명 URL 로만(service role),
--     버킷 자체 제한(8MB, PNG/JPEG/WebP)이 서버측 2차 방어. anon insert 정책 없음.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('wappen', 'wappen', true, 8388608, array['image/png','image/jpeg','image/webp'])
  on conflict (id) do update
    set public = excluded.public, file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists wappen_public_read on storage.objects;
create policy wappen_public_read on storage.objects for select using (bucket_id = 'wappen');
