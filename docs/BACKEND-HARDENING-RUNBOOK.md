# 백엔드 하드닝 배포 런북 (2026-07-07)

지시하신 대로 **일부만 수정**하고 나머지는 설명만 드립니다. 이 변경은
`claude/project-understanding-wioiao`(=Cloudflare **프리뷰**, 프로덕션 무영향)에 있습니다.

| 항목 | 처리 | 비고 |
|---|---|---|
| 1. 도어락/PII 하드코딩 | **수정** | documents 로 이전 + 소스 제거 |
| 2. send-email 오픈 릴레이 | 설명만 | 코드 변경 없음(원상복구) |
| 3. 관리자 푸시 비인증 | 설명만 | 코드 변경 없음(원상복구) |
| 4. 커뮤니티 수정/삭제·해시 노출 | **수정** | 모임별 PW 서버검증 함수 + 클라 폴백 |
| 5. 밴드 관리자 권한 상승 | **수정** | '게더링' 로그인 아이디로 판정 (아이디 값 필요) |
| 6. check-band-payments 비인증·노출 | **수정** | CRON_SECRET 게이트 + 응답 정보 제거 |
| 7. verify-community-admin 브루트포스 | **수정** | IP별 시도 제한 + 상수시간 비교 |
| 8. Firebase 이중 호스팅 | **수정(폐기)** | firebase.json/.firebaserc/public 제거 |
| 9. 경미(Drive키/스택/sw.js) | 설명만 | 코드 변경 없음(원상복구) |

> ⚠️ **순서 중요**: `index.html` 은 master push 시 프로덕션 자동 배포됩니다. 아래 Supabase 단계를 **먼저** 끝낸 뒤 master 로 ff 하세요.

---

## ❗ 먼저 필요한 값 (항목 5)
`index.html` 의 `GATHEO_ADMIN_BAND_ID` 상수(현재 빈 값)에 **게더링 계정의 로그인 아이디**(영문/숫자, 예: `gatheo`)를 넣어야 합니다.
- 밴드 계정은 로그인 아이디(rawId)가 auth 이메일 접두사(`<id>@band.gatheo.kr`)이자 프로필 `instruments` 에 저장되며 **편집 불가**이므로, 표시명(`band_name_kr`) 대신 이 값으로 관리자를 판정합니다.
- **값이 비어 있는 동안은 임시로 기존 이름 기반 폴백**이 동작합니다(=아직 취약). 아이디를 알려주시면 상수를 채우고 폴백을 제거합니다.

## 적용 순서

### 1. Supabase SQL 실행 (먼저)
`supabase/migrations/20260707_backend_hardening.sql`:
- `documents` 생성 + 안내문 seed + 관리자 RLS (항목 1)
- `community_verify_pw` RPC + pgcrypto (항목 4 후속용)
- `auth_attempts` 테이블 (항목 7 rate-limit)

### 2. Supabase Edge Functions 재배포
```bash
supabase functions deploy verify-community-admin   --project-ref <REF> --no-verify-jwt   # 항목 7
supabase functions deploy verify-meeting-password  --project-ref <REF> --no-verify-jwt   # 항목 4 (신규)
supabase functions deploy check-band-payments      --project-ref <REF> --no-verify-jwt   # 항목 6
```
Secrets (선택):
```bash
# 항목 6: pg_cron ↔ check-band-payments 호출 인증
supabase secrets set CRON_SECRET=<값> --project-ref <REF>
#   → pg_cron 잡의 net.http_post headers 에 "x-cron-secret":"<값>" 추가
```
(항목 7 rate-limit 은 Edge 런타임 기본 제공 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 사용 — 별도 secret 불필요)

### 3. 항목 5 아이디 반영
`GATHEO_ADMIN_BAND_ID` 채우기(위 참조) 후 커밋.

### 4. master 로 프로덕션 배포 (feature → master ff)
1~3 이 끝난 뒤:
```bash
git push origin claude/project-understanding-wioiao:master
```
검증: 공연대관 관리자 탭 승인 안내문에 도어락 정보 정상 표시(documents 로드), 커뮤니티 주최자/마스터 로그인 정상, 밴드 관리자 패널이 '게더링' 계정에서만 표시.

### 5. 도어락 물리 변경 (항목 1, 코드로 못 끝남)
출입 코드(`0815`, `20251220`)는 이미 공개 repo 히스토리에 노출됨 → **실제 도어락 번호 변경** 후 새 번호는 `documents.perf_approval_template` 에만 반영(소스 커밋 금지).

---

## 수정한 코드 요약 (이 브랜치)

| 항목 | 파일 | 내용 |
|---|---|---|
| 1 | `index.html`(generateApprovalMessage, loadPerfApprovalTemplate, renderPerfAdminTab) + SQL(documents) | 안내문을 관리자 RLS documents 에서 로드, 미로드 시 민감정보 없는 폴백. 소스에서 도어락/Wi-Fi/연락처 제거 |
| 4 | `supabase/functions/verify-meeting-password`(신규), `index.html`(verifyMeetingPassword, checkCommunityOrganizer) | 모임별 PW 서버 검증(해시 클라 미전송), 미배포 시 기존 클라 해시 폴백 |
| 5 | `index.html`(isBandAdmin) | '게더링' 로그인 아이디(instruments, 편집불가)로 판정. 예약어 팀명 변경 차단(saveBandInfo) |
| 6 | `supabase/functions/check-band-payments` | CRON_SECRET 호출 인증(선택), 응답에서 팀명/납부상태(alertTeams) 제거 |
| 7 | `supabase/functions/verify-community-admin` + SQL(auth_attempts) | IP별 시도 제한(429), 상수시간 비교 |
| 8 | `firebase.json`, `.firebaserc`, `public/` 삭제 | Firebase 호스팅 폐기 (실제 중단은 Firebase 콘솔에서 호스팅 비활성화) |

## 설명만 한 항목 (코드 변경 없음)
- **2, 3, 9** 는 요청대로 손대지 않았습니다. 상세 설명은 채팅 답변 참조.

## 남은 후속 작업 (권장, 별도 PR)
- **항목 4 완전 강제**: verify-meeting-password 배포 후 `fetchCommunityMeetings` 의 `select('*')` 에서 `password_hash/password_salt` 제거 + 클라 해시 폴백 제거, 수정/삭제를 SECURITY DEFINER RPC 경유로 전환(콘솔 우회 차단).
