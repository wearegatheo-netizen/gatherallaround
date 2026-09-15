# CLAUDE.md

이 저장소에서 작업할 때 지켜야 할 규칙과 과거 실수에서 얻은 교훈을 기록합니다.

## 프로젝트 개요
- `index.html` 단일 파일 SPA — UI + 로직 전부 이 안에 있음 (약 14,000줄)
- 백엔드: Supabase (`profiles`, `reservations`, `schedules`, `schedule_attendees`, `performance_bookings`,
  공연 예매: `event_hosts`/`events`/`event_tickets`/`event_ticket_seats`(매수별 QR·좌석 체크인) + `event_seats` 뷰)
- 공연 예매(두둥식, `#shows`/`#host` 라우트): 읽기만 anon, **쓰기는 전부 `functions/event-api.js`**
  (service role, 호스트 인증은 카카오 access token을 kapi.kakao.com에서 서버 검증).
  PII 테이블(event_hosts/event_tickets)은 anon RLS 정책 없음. 좌석 정합성은 `book_event_ticket` RPC(FOR UPDATE)만.
  QR 티켓 = `#host/checkin/{code}` 딥링크 (vendor/qrcode-generator 자체 호스팅).
- 문자: `functions/send-sms.js` (솔라피, 공간 대관 접수 확인 자동 발송 — 예약번호·4시간 자동취소 안내 포함)
- 고정 합주팀(밴드 계정, `profiles.member_type='band'`): 회차 모델은 내부운영 시트 "진행중인 고정팀"과 동일 —
  `band_start_date` + 28n = 시작일_n, 종료일_n = 시작일_n + 21, **입금일_n = 시작일_n − 14**(n≥1, 3주차 사용일 = 다음 시작일 2주 전; 등록은 시작일 당일).
  계약 정보(`band_start_date/band_expected_months/band_deposit/band_deposit_paid_at/band_fee/band_ended_at/band_memo`),
  납부 장부 `band_payments`(+`cycle_no`, `amount`; 구형 행은 납부 창 [시작일_n−21, 시작일_n+7) 로 귀속). 수식은 세 곳을 항상 동일하게:
  `index.html bandCycle*` / `functions/send-reminders.js` / `supabase/functions/check-band-payments`.
  입금 안내 문자: 매일 12:00 KST 크론(`band-rent-sms.yml`, `{scope:'band'}`) → `/send-reminders` 월세 블록 — 미납 시 회차당 최대 3회:
  입금일 당일(`due`, 3주차) → 시작 1주 전(`week4`, 4주차) → 시작 전날(`last`). `band_rent_reminders(team_id, cycle_no, kind)` PK 선점으로
  회차·종류별 1회, 솔라피 키 없으면 블록 꺼짐. 대관 D-2 푸시·파기는 08:00 크론(`perf-reminder.yml`, `{scope:'booking'}`)이 담당.
  관리자 문자 테스트: 팀 관리 탭 [문자 테스트] → `/send-reminders` `{action:'test_band_sms', sb_token}`(게더링 밴드 계정 세션만, 본인 번호로만).
  게더링 관리자(로그인 ID `wearegatheo`) 화면: 팀 관리(계약·회차·입금 인라인 폼) + 「현황표」(시트 이식, 카드/표/CSV).
  토스뱅크 계좌 문구는 `index.html`(대관 조회 카드·밴드 본인 화면) / `send-sms.js` / `send-reminders.js` 세 곳 동기화.
- 공간 대관: 예약번호 6자리 `booking_code`(예매번호와 동일 charset, 클라 생성+unique 충돌 재시도),
  [예약 조회]는 anon select 후 연락처 대조. 4시간 자동취소는 크론 없이 lazy —
  `_pbExpired()`로 화면·가용성 계산에서 즉시 만료 취급 + 관리자 탭 진입 시 `status:'expired'` sweep.
  D-2 관리자 알림: GitHub Actions 크론(매일 08:00 KST, `{scope:'booking'}`) → `/send-reminders`
  (`reminder_sent_at` 선점으로 건당 1회, 놓친 날은 D-1/D-DAY 캐치업, 푸시는 `/notify-admins` 재사용).
- 공용 시간표 달력: 대관 달력 렌더러(renderPerfCal/renderPerfMonth/renderPerfWeek/perfWeekSlotClick 등)는
  `_calCtx`{state, ids, minSlots, onChange} 컨텍스트로 구동 — 대관 페이지(`_perfCalCtx`, 최소 3슬롯)와
  커뮤니티 모임 등록 폼(`initCommunityCal`, 최소 1슬롯, 선택 시 cc_date/cc_start_time/cc_end_time 자동 입력)이 공유.
  달력 함수 안에서는 `_perfState` 대신 `_cs()`를 쓸 것.
- 테스트: `tests/` (event-api·send-sms·send-email·send-reminders·notify-admins 단위, shows/host/band UI —
  Playwright는 scratchpad node_modules 필요, `ui-band.js`는 가짜 supabase 쿼리빌더로 밴드 관리자 화면 검증)
- 개발 브랜치: `claude/confident-cannon-59bh3c`

## ⚠️ Git 작업 전 필수 체크리스트 (중요)

> **2026-06-04 실수 기록:** 세션을 이어받자마자 `git merge master`를 했는데,
> 신뢰한 `origin/claude/...` 참조가 **오래된 로컬 캐시**였다. 실제 원격은
> 다른 계보로 한참 앞서 있었고(`ffe2b44`), 그 위에 틀린 베이스로 커밋을 쌓았다.
> push 권한이 막혀 있어 divergence가 마지막에야 non-fast-forward 거부로 드러났다.

이 실수를 반복하지 않으려면 **작업(merge/rebase/commit) 시작 전에 항상:**

1. **원격을 먼저 fetch한다** — stale한 `origin/` 추적 참조를 절대 믿지 말 것
   ```bash
   git fetch origin claude/complete-index-modification-siszr
   git log --oneline origin/claude/complete-index-modification-siszr -5
   ```
2. **현재 로컬 베이스가 진짜 원격 최신인지 확인한 뒤** merge/rebase 진행
3. **이어받은 세션(continued session)에서는 특히** 로컬 상태를 신뢰하지 말고 fetch로 검증
4. **push가 막혀 있으면** 단순 권한 문제로 단정하지 말고 **divergence 가능성도 의심**
5. 작업이 원격 최신 위에 깔끔히 fast-forward되는지 push 전에 확인:
   ```bash
   git rev-list origin/<branch>..HEAD --count   # 올릴 커밋 수
   git merge-base --is-ancestor origin/<branch> HEAD && echo OK   # ff 가능 여부
   ```

## 배포 규칙
- 작업 완료 후 **항상 master에도 머지·push**한다 (feature 브랜치만 push하고 끝내지 말 것)
- fast-forward 가능하면 `git merge --ff-only origin/<feature>` → push
- push는 PAT를 github.com URL에 직접 넣어 프록시 우회:
  ```bash
  git push "https://<PAT>@github.com/wearegatheo-netizen/gatherallaround.git" master
  ```

## 커밋 서명
- 커밋 전 항상: `git config user.email noreply@anthropic.com && git config user.name Claude`
- 서명 검증 로컬 확인이 필요하면:
  `git config gpg.ssh.allowedSignersFile <file>` 에 `noreply@anthropic.com <pubkey>` 등록

## 코드 컨벤션 / 패턴
- **인라인 오류 메시지**: 로그인/가입/공연대관 폼은 `alert()` 대신 폼 내부 result div 사용.
  패턴: `<div id="xxxResult" style="font-size:0.88rem;text-align:center;min-height:22px;padding:2px 0"></div>`
  핸들러에서 `const showErr = (msg) => { res.textContent = msg; res.style.color = '#e74c3c'; }`,
  진입 시 `res.textContent = ''`로 초기화, 폼 전환 함수에서도 stale 메시지 비우기.
- 성공 알림은 `showToast(msg)` 사용. DB 오류는 사용자 문구("저장하지 못했습니다…")로 바꾸고 원문은 `console.error`.
- **버튼은 공용 클래스만**: `gaa-btn` + 변형(`-primary` 파란 채움 / `-secondary` 회색 테두리 / `-danger` 빨간 테두리 /
  `-ghost`·`-ghost-danger` 텍스트) + 크기(`-sm` 8px 15px·9px / `-xs` 5px 10px·8px, 목록 밀도용) + `-block`(전체 폭).
  인라인 `style`로 색·반경·패딩을 새로 쓰지 말 것(레이아웃 속성 flex/margin 만 허용). 소형 액션 줄은 `_gaaBtn(label, onclick, color)`.
  예외(의도적 차별): 카카오 브랜드(#FEE500), `.inst-btn` 칩 선택, 원형 아이콘, 세그먼트 필, 게임/테스트 존.
- **상태 칩은 `.status-badge`** (+`sm`) 와 `status-pending/approved/rejected/info/neutral` 조합 — 다크모드 색이 함께 정의돼 있다.
- 합주팀 화면 폼 입력은 `.band-input`, 빈/로딩 상태는 `_bandEmptyHTML()`, 제출 버튼은 `_bandBusy(btn, on)`으로 이중 제출 차단.
  레이어는 [페이지 배경]→[`.band-section-card`] 한 겹만(팀 항목은 `.band-team-card` 구분선 리스트, 인라인 폼은 점선 구분, 중첩 카드 금지).
  크기: 입력 44px(`--b-input-h`) · 폼 제출 `gaa-btn`(md 44px) · 카드 액션 `gaa-btn-sm`(38px) · 목록 소형 `gaa-btn-xs`(32px).
  입력+버튼 한 줄은 `.band-form-row`(≤480px에서 버튼이 아래로), 폼 하단 버튼은 `.band-submit-row`.
  전역 `input[type="text"]{height:52px}`·`[style]{height:auto}` 규칙 때문에 밴드 입력 선택자는 `#band-main-content input.band-input`로 특이도를 올려 둠.
  밴드 페이지는 `fullwidth-view`(본문 좌우 패딩 0) — 새 화면도 `#band-main-content { margin:-12px -6px }` 같은 음수 마진 해킹 금지.
  "댓글" 섹션의 정식 명칭은 "요청사항"(팀→게더링 요청 창구, 테이블·함수명은 band_comments 유지).
  팀 관리 탭은 `.band-team-group`(+`.band-group-title`)으로 「계약 팀 N팀」→「관리 팀(게더링 운영 계정, `.band-team-card.admin` 연한 배경)」 순 분리,
  관리 팀은 계약·회차·문자·납부 알림 대상에서 제외. 시드 표식 메모 "시트 이관"은 DB엔 두고 화면에서만 `_bandDisplayNote()`로 숨김.
  `.band-form-grid`는 `minmax(0,1fr)` 열 + `label{min-width:0}` — date/number 입력은 `appearance:none`으로 모바일 고유 폭 넘침 방지.
- 민감정보(도어락 번호 등)는 관리자 UI에서만 노출, 공개 화면 금지.
