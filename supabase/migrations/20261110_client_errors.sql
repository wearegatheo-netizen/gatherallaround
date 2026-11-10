-- ═══════════ 브라우저 오류 기록 — 2026-11-10 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. 여러 번 실행해도 안전.
-- 방문자 브라우저에서 난 스크립트 오류를 /client-log 가 여기에 남기고, 운영 총괄이 관리자 › 운영 도구에서 본다.
-- 개인정보 없음(메시지·스택·화면 경로·브라우저 종류). 쓰기·읽기 모두 서버 함수(service role)만 — 정책 없음.
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  message    text not null,
  stack      text,
  page       text,
  source     text,
  kind       text,
  role       text,
  ua         text
);
create index if not exists client_errors_created_at on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
-- 오래된 기록 정리(선택): delete from public.client_errors where created_at < now() - interval '60 days';
