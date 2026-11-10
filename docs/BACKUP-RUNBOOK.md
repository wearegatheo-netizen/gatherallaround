# 백업·복구 안내

게더 올 어라운드의 자료는 전부 Supabase(DB + 사진 저장소)에 있다. 코드는 GitHub 에 있으므로 잃을 것은 **DB 자료와 사진**뿐이다.

## 1. 평소에 해 둘 것

| 무엇 | 어떻게 | 주기 |
|---|---|---|
| DB 자료 | 사이트 → 게더링 → 관리자(톱니) → **🛠️ 운영 도구 → 백업 파일 내려받기** (운영 총괄만) | 한 달에 한 번 + 마이그레이션 SQL 실행 전 |
| Supabase 자체 백업 | Supabase 대시보드 → Database → Backups 에서 **지금 요금제에 자동 백업이 있는지** 확인 | 한 번만 |
| 사진(대표 이미지·포스터·아바타) | Supabase 대시보드 → Storage → 버킷(`community-images`, `wappen`)을 폴더째 내려받기 | 분기에 한 번 |

- 내려받은 파일 `gatherallaround-backup-YYYYMMDD.json` 에는 **이름·연락처·캐비넷 비밀번호**가 들어 있다. 개인 기기의 안전한 곳에만 두고 메신저·메일로 보내지 않는다. 석 달 지난 파일은 지운다.
- 파일 구조: `{ exported_at, tables: { 표이름: [행…] }, missing: [없는 표] }`. 대상 표 목록은 `functions/gatheo-api.js` 의 `BACKUP_TABLES`.
- 포함되지 않는 것: 사진 파일, 로그인 계정(Supabase Auth — 합주팀 아이디·비밀번호), 로그인 세션.
- Supabase 무료 요금제는 자동 백업이 없거나 기간이 짧을 수 있다. 대시보드에서 확인하고, 없다면 위의 수동 백업이 유일한 사본이다.

## 2. 사고가 났을 때

### 실수로 지웠거나 잘못 고쳤다 (일부 행)
1. 더 건드리지 말고 무엇이 언제 바뀌었는지 적는다.
2. 가장 최근 백업 파일에서 해당 표를 찾는다.
3. Claude 에게 백업 파일의 해당 부분과 상황을 주고 **복구 SQL** 을 받아 Supabase SQL Editor 에서 실행한다.
   - 예: "백업의 `reservations` 중 11/20 날짜 행을 다시 넣는 SQL 을 만들어줘. 이미 있는 id 는 건너뛰게."
   - 복구 SQL 은 `insert … on conflict (id) do nothing` 형태로, 지금 있는 자료를 덮어쓰지 않게 한다.

### 표 전체 또는 DB 전체가 망가졌다
1. Supabase 대시보드 → Database → Backups 에 복원 지점이 있으면 그것으로 되돌린다(가장 빠르고 완전하다). 복원 시점 뒤에 들어온 자료는 사라진다.
2. 없으면 백업 파일로 표를 하나씩 되살린다. 순서는 참조 관계 때문에 `profiles` → `teams`·`schedules`·`reservations`·`time_blocks` → 나머지.
3. 복구 뒤 `supabase/migrations/` 의 SQL 중 실행한 적 있는 것을 날짜순으로 다시 확인한다(권한 정책은 백업 파일에 없다).

### 화면이 갑자기 안 된다 (자료는 멀쩡)
- 방금 SQL 을 실행했다면 그 파일 끝의 「되돌리기」 블록을 실행한다. 권한 잠금은 `20261110_gatheo_lockdown.sql` 끝에 있다.
- 관리자 → 운영 도구 → **브라우저 오류 기록**에 같은 오류가 여러 번 찍혀 있는지 본다.
- GitHub → Actions 의 `tests` 가 빨간색이면 마지막 변경이 원인일 가능성이 크다. Cloudflare Pages → Deployments 에서 이전 배포로 되돌릴 수 있다(Rollback).

## 3. 점검 (분기에 한 번)
- [ ] 백업 파일을 받아 열어 보고 `tables.profiles` 에 멤버가 다 있는지 확인
- [ ] Supabase 대시보드의 백업 항목 확인
- [ ] 사진 버킷 내려받기
