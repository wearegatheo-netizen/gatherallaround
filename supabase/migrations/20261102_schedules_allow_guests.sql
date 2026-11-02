-- ═══════════ 게더링 일정표: 날짜별 「외부인 참여 신청 받기」 선택 — 2026-11-02 ═══════════
-- 실행: Supabase 대시보드 → SQL Editor 에서 1회. (20261102_schedule_guests 와 함께)
--
-- 일정 편집기에 체크박스 하나 — 켠 날짜에만 슬롯 줄에 [+ 외부] 버튼이 보인다(기본은 끔 = 받지 않음).
-- 값은 그 날짜의 schedules 행 전부에 같은 값으로 저장된다(signup_open/close 와 같은 방식).
-- 컬럼이 아직 없으면(마이그레이션 전) 화면은 종전처럼 모든 날짜에 외부인 신청을 허용한다.

alter table public.schedules add column if not exists allow_guests boolean not null default false;
