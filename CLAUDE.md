# CLAUDE.md

이 저장소에서 작업할 때 지켜야 할 규칙과 과거 실수에서 얻은 교훈을 기록합니다.

## 프로젝트 개요
- `index.html` 단일 파일 SPA — UI + 로직 전부 이 안에 있음 (약 16,500줄)
- 백엔드: Supabase (`profiles`, `reservations`, `schedules`, `schedule_attendees`, `performance_bookings`,
  공연 예매: `event_hosts`/`events`/`event_tickets`/`event_ticket_seats`(매수별 QR·좌석 체크인) + `event_seats` 뷰)
- 공연 예매(두둥식, `#shows`/`#host` 라우트): 읽기만 anon, **쓰기는 전부 `functions/event-api.js`**
  (service role, 호스트 인증은 카카오 access token을 kapi.kakao.com에서 서버 검증).
  PII 테이블(event_hosts/event_tickets)은 anon RLS 정책 없음. 좌석 정합성은 `book_event_ticket` RPC(FOR UPDATE)만.
  QR 티켓 = `#host/checkin/{code}` 딥링크 (vendor/qrcode-generator 자체 호스팅).
- 가수·곡 검색(마이페이지 음악 취향·팀 연습곡): 두 축을 **브라우저 `musicSearch(q,type,limit)`** 가 합친다 —
  ① 애플 iTunes **KR 뮤직비디오**(한글 표기·표지) 브라우저 직접 호출(`_appleMusicSearch`; Workers 에서 부르면 애플이 429 로 막음, 실측)
  ② **Deezer**(무료·키 없음, CORS 없음)는 `functions/music-search.js` 프록시(`/search/track|artist`, 오류가 HTTP 200 본문 `error`로도 옴 — 쿼터 code 4, no data 800은 빈 결과).
  2026-09-28 iTunes KR 스토어 `entity=song` 결과가 전부 0건으로 바뀌어(코드 변경 없이 깨짐) 교체. 스포티파이는 앱 소유 계정 **프리미엄 필수**(403)라 같은 날 Deezer 로 교체(SPOTIFY_* 환경변수 미사용).
  합치기 `_mergeMusicResults`(애플 먼저·정규화 키 중복 제거), 결과 없음·실패 시 입력값 그대로 등록하는 칩/줄.
  서버 함수는 우리 출처만(Sec-Fetch-Site/Origin/Referer), q≤60자, 1일 캐시(Deezer IP 쿼터 5초 50회 보호), 실패는 **500** JSON(502 는 Cloudflare 가 본문을 가림).
  상태는 `functions-diagnostics` 워크플로로 확인.
- 부팅·세션 복원(`initSession`): 루트(포털)로 들어오면 저장된 세션(Supabase 이메일 = 게더링 회원/합주팀 공용, 카카오 캐시 `gaa_kakao_uid`)을
  **상태만 복구하고 화면은 포털**에 둔다(2026-10-06, 직전 계정 화면이 바로 뜨던 문제). 포털의 [게더링]/[고정 합주팀] 버튼(`showGatheoSection`/`showBandSection`)이
  복구된 세션이 있으면 로그인 폼 대신 `loginUI`/`loginBandUI` 로 바로 진입. 섹션 딥링크·새로고침(`#gatheo/…`, `#band`)은 종전처럼 바로 그 화면
  (`checkEmailUserApproval(user, {target})`, 다른 구역·공개 섹션이면 `_finishBoot()`). `_gatheoEntered` 로 "세션만 복구" 와 "loginUI 실행(데이터 로딩)" 을 구분 —
  라우터가 미진입 세션이면 `loginUI` 를 부른다. 명시적 로그아웃은 `gaa_portal_required` 로 다음 부팅에서 세션 해제.
- 문자: `functions/send-sms.js` (솔라피, 공간 대관 접수 확인 자동 발송 — 예약번호·4시간 자동취소 안내 포함)
- 고정 합주팀(밴드 계정, `profiles.member_type='band'`): 회차 모델은 내부운영 시트 "진행중인 고정팀"과 동일 —
  `band_start_date` + 28n = 시작일_n, 종료일_n = 시작일_n + 21, **입금일_n = 시작일_n − 14**(n≥1, 3주차 사용일 = 다음 시작일 2주 전; 등록은 시작일 당일).
  계약 정보(`band_start_date/band_expected_months/band_deposit/band_deposit_paid_at/band_fee/band_ended_at/band_memo`),
  납부 장부 `band_payments`(+`cycle_no`, `amount`; 구형 행은 납부 창 [시작일_n−21, 시작일_n+7) 로 귀속). 수식은 세 곳을 항상 동일하게:
  `index.html bandCycle*` / `functions/send-reminders.js` / `supabase/functions/check-band-payments`.
  입금 안내 문자: **목표 발송 12:00 KST**. 크론 4회 예약(06:37 본 실행·08:07·11:07·13:37 KST, `band-rent-sms.yml`, `{scope:'band'}`) —
  러너가 정오 전에 도착하면 정오까지 `sleep` 후 호출(공개 저장소라 대기 무료, `timeout-minutes: 350`, 정오까지 5h40m 넘게 남으면 건너뜀),
  정오 이후 도착이면 즉시 호출. 서버는 **KST 11:00 이전 호출을 건너뜀**(`BAND_SMS_EARLIEST_HOUR`, 2차 안전망, 선점 없음 → 다음 실행이 발송).
  수동 실행은 workflow_dispatch `force`(대기·창 모두 무시, 서버 `{force:true}`). GitHub 예약이 분과 무관하게 4h49~6h33 늦게 도는 실측(2026-09-16~28)
  기준 06:37 본 실행이 11:26~13:10 도착 → 발송 12:00~13:10. 미납 시 회차당 최대 3회:
  입금일 당일(`due`, 3주차) → 시작 1주 전(`week4`, 4주차) → 시작 전날(`last`). `band_rent_reminders(team_id, cycle_no, kind)` PK 선점으로
  회차·종류별 1회, 솔라피 키 없으면 블록 꺼짐. 대관 D-2 푸시·파기는 07:47 크론(`perf-reminder.yml`, `{scope:'booking'}`, 10:17 예비)이 담당.
  ※ GitHub 스케줄은 정각 여부와 무관하게 약 5시간 반 늦게 돈다(2026-09 실측, 정각 회피 효과 없음) — 시각이 중요한 크론은 그만큼 당겨 걸고
  러너에서 목표 시각까지 대기시킬 것(작업 한도 6h 주의). 지연 폭이 바뀌면 `band-rent-sms` 실행 이력(Actions)으로 재측정해 예약 시각을 조정.
  관리자 문자 테스트: 관리자 「🧪 알림 테스트」 서브탭(`bandTestTabHTML`, 팀 관리 탭엔 없음) → `/send-reminders` `{action:'test_band_sms', sb_token, kind}`(게더링 밴드 계정 세션만, 본인 번호로만).
  [푸시 테스트]는 같은 액션에 `push:'only'` — 문자 없이 실제 발송 때와 같은 `/notify-admins` 푸시(운영 총괄, `[테스트]` 제목)만; `push:true`면 문자+푸시.
  게더링 관리자(로그인 ID `wearegatheo`) 화면: 팀 관리(계약·회차·입금 인라인 폼) + 「현황표」(시트 이식, 카드/표/CSV).
  화면의 "입금일" 표시(현황표 표·카드 칩·팀 카드/본인 화면 요약)는 `bandCycleInfo().nextDueN`(다음 **미납** 회차) 기준 — 다음 회차를 선납했으면 그 다음 회차 입금일을 보여준다.
  토스뱅크 계좌 문구는 `index.html`(대관 조회 카드·밴드 본인 화면) / `send-sms.js` / `send-reminders.js` 세 곳 동기화.
- 공간 대관: 예약번호 6자리 `booking_code`(예매번호와 동일 charset, 클라 생성+unique 충돌 재시도),
  [예약 조회]는 anon select 후 연락처 대조. 4시간 자동취소는 크론 없이 lazy —
  `_pbExpired()`로 화면·가용성 계산에서 즉시 만료 취급 + 관리자 탭 진입 시 `status:'expired'` sweep.
  D-2 관리자 알림: GitHub Actions 크론(매일 07:47 KST + 10:17 예비, `{scope:'booking'}`) → `/send-reminders`
  (`reminder_sent_at` 선점으로 건당 1회, 놓친 날은 D-1/D-DAY 캐치업, 푸시는 `/notify-admins` 재사용).
- 공용 시간표 달력: 대관 달력 렌더러(renderPerfCal/renderPerfMonth/renderPerfWeek/perfWeekSlotClick 등)는
  `_calCtx`{state, ids, minSlots, onChange} 컨텍스트로 구동 — 대관 페이지(`_perfCalCtx`, 최소 3슬롯)와
  커뮤니티 모임 등록 폼(`initCommunityCal`, 최소 1슬롯, 선택 시 cc_date/cc_start_time/cc_end_time 자동 입력)이 공유.
  달력 함수 안에서는 `_perfState` 대신 `_cs()`를 쓸 것.
- 테스트: `tests/` (event-api·send-sms·send-email·send-reminders·notify-admins·music-search 단위, shows/host/band UI —
  Playwright는 scratchpad node_modules 필요, `ui-band.js`는 가짜 supabase 쿼리빌더로 밴드 관리자 화면 검증)
- 개발 브랜치: `claude/exciting-gauss-83p6k1`

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
  팀 관리 탭은 `.band-team-group`(+`.band-group-title`)으로 「계약 팀 N팀」→「관리 팀(게더링 운영 계정)」 순 분리, 관리 팀은 계약·회차·문자 대상에서 제외.
  요금 명칭은 화면·문자 모두 「이용료」(사용료 ✗). 미납 관리자 푸시는 문자 발송 시 서버(`/send-reminders`)만 보내며, 페이지 접근 시 클라이언트 푸시는 없음(2026-09-16 제거).
  여러 소제목(계약 정보·회차·입금)을 가진 팀 항목은 `.band-team-card.block` — 이름 줄(`.band-card-top`)이 섹션 카드 폭 전체의 배경 띠(헤더,
  `margin:0 calc(-1*var(--b-card-pad))`, 관리 팀은 `.admin` 파란 톤)가 되어 팀 경계를 소제목 구분선과 구별한다(팀 관리·현황표 카드 공통). 가입 신청 목록은 단순 구분선 리스트. 시드 표식 메모 "시트 이관"은 DB엔 두고 화면에서만 `_bandDisplayNote()`로 숨김.
  `.band-form-grid`는 `minmax(0,1fr)` 열 + `label{min-width:0}` — date/number 입력은 `appearance:none`으로 모바일 고유 폭 넘침 방지.
- 민감정보(도어락 번호 등)는 관리자 UI에서만 노출, 공개 화면 금지.

## 와펜 꾸미기 (`/wappen/`, 2026-10-06)
- **별도 페이지** `wappen/`(index.html·style.css·app.js·editor.js·render.js·presets.js, ESM) — index.html 과 독립. 같은 카카오 앱·Supabase.
  디자인 토큰·`.gaa-btn`·`.status-badge`·토스트는 `wappen/style.css` 에 복사본(index.html 과 동기화 대상). 다크모드 키 `gaa_theme` 공유.
- **계정**: 전용 `wappen_users`(카카오 로그인 즉시 이용, 승인 없음). 관리자 = 카카오 ID `4883868250` 백스톱 + `is_admin`.
  **세션**: `login {kakao_token}` 1회 kapi 검증 → 서버 발급 토큰 30일(DB 엔 sha256 해시, `wappen_sessions`) → `localStorage.wappen_session`.
  인앱 브라우저 리다이렉트 복귀는 `sessionStorage.wappen_return` 마커로 자동 로그인.
- **쓰기는 전부 `functions/wappen-api.js`**(service role, `{action, session}`; 우리 출처 아니면 403). 읽기는 anon(RLS `status='active'`) + RPC `wappen_ranking`.
  `wappen_users/sessions/reactions/item_requests/reports` 는 anon 정책 없음. 작성자 표시명은 `author_name/author_avatar` 복제(뷰 join 없음, 닉네임 변경 시 서버가 함께 PATCH).
  집계는 트리거(`reaction_count/reaction_counts`, `works_count`) — 클라 read-then-write 금지.
- **업로드**: 바이트 프록시 없음. `upload_sign {kind, ext}` → 서명 URL(경로 `base|thumbs|previews|requests/<uid>/`, `items/` 는 관리자만) → 브라우저 PUT(`Content-Type` 필수).
  저장 액션은 URL 접두를 재검증(event-api `posterOk` 방식). 버킷 `wappen` 공개·8MB·PNG/JPEG/WebP.
- **사이즈 프리셋**은 `wappen/presets.js` 한 곳 — 브라우저와 Pages Function 이 같은 파일을 import. 인쇄(A1~A5·B4/B5 JIS, mm→300dpi px, 세로/가로)·SNS(px 고정).
  **레이아웃** `{v:1, items:[{id,x,y,w,r,fx}]}` 비율 좌표(배열 순서 = z, ≤200개) — `render.js drawScene` 하나로 에디터·미리보기(1080px JPEG)·다운로드를 그린다.
  다운로드는 300→200→150→100dpi 폴백(`probeCanvas` 로 기기 한계 감지).
- **공유 링크는 루트+쿼리** `https://gatherallaround.com/?wp=<프로젝트>`·`?ww=<작품>`(`shareUrl()`) — 카카오톡 공유에서 동작이 검증된 유일한 형태.
  하위 경로 `/wappen/?p=` 는 카톡 인앱 브라우저에서 포털로 떨어졌다(2026-10-06 실측, 404 SPA 폴백도 루트로 감). 루트 `index.html` `<head>` 맨 앞 인라인 스크립트가
  `wp/ww`(예전 `p/w` 포함, UUID 검사)를 `/wappen/#/project|work/<id>` 로 `location.replace`. `functions/_middleware.js` 는 루트·`/wappen/` 양쪽 쿼리에 OG 주입
  (`og:url` 은 루트 표준 형태, `?news=` 우선). 해시는 카톡이 버리므로 쿼리만 쓴다.
- 반응 5종(love/cool/lol/wow/fire, 작품당 1인 1개) · 리믹스(`remix_of`) · 신고/숨김/차단 · 와펜 요청(관리자 승인 시 등록 와펜 연결). 댓글 없음.
  와펜 등록 폼(`itemFormModal`)은 PNG·JPG·WebP 를 받아 **클라이언트에서 PNG 로 변환**(투명 유지, MIME 대신 디코드 성공으로 판정 — iOS 는 type 이 비기도 함).
  요청 승인은 같은 폼을 `prefill.request` 모드로 열어 요청자의 참고 이미지를 기본 선택 → [승인하고 등록] 한 번으로 등록+`admin_request_resolve(approved)`.
- **크기 체계(2026-10-06 통일)**: 글자는 `--fs-h1 1.25 / h2 1.02 / body 0.92 / sm 0.84 / xs 0.76rem` 5단계만(예외: hero 제목·탭 라벨·메달·빈 상태 아이콘·서랍 라벨).
  버튼은 `gaa-btn` md 44px = 폼 제출 `-block`·로그인만 / `-sm` 38px = 페이지 안 모든 액션 줄·모달 액션·CTA / `-xs` 32px = 리스트 행·에디터 상단바.
  아이콘은 `icon(name)`(app.js, 16px 단색 SVG·currentColor)만 — 버튼 텍스트에 이모지 금지(감정표현 5종·빈 상태 장식·로고만 예외, UI 테스트가 검사).
  상세 페이지 주 동작은 `.action-row`(sm 버튼 균등 분할 + 끝에 `icon-only` ⋯) 한 줄, 부가 동작(수정·숨기기·삭제·링크 복사·신고)은 `moreSheet()` 하단 시트.
  페이지 제목은 `.page-head`, 섹션은 `.section-title`(h2 + `.more`), 세그먼트 `.seg`(36px, `<a>`/`<button>` 공통), 인라인 `font-size` 금지.
  뷰 안에서 `#app` 에 거는 위임 리스너는 `onAppClick()`(render 마다 AbortController 로 해제 — 직접 `app.addEventListener` 하면 다음 화면에서도 살아남아 중복 동작).
- 모바일(≤640px)은 헤더 메뉴 대신 **하단 탭바**(`.wp-bottom-nav`, SVG 아이콘, 편집 화면에선 숨김). 설치형(PWA, 상태바 black-translucent)·노치 대응은
  `--wp-safe-top/--wp-safe-bottom`(env(safe-area-inset-*))을 헤더·에디터·탭바·시트가 공유. `label.dropzone` 은 반드시 `display:block`(inline 이면 점선 테두리가 깨짐).
  이미지 업로드 UI 가 추가되면 같은 `.dropzone` 클래스를 쓸 것.
- 테스트: `tests/wappen-api-unit.mjs`·`tests/middleware-unit.mjs`(node) · `tests/ui-wappen.js`(Playwright, 가짜 supabase/Kakao/API, `VIEWPORT=390x844 DARK=1 SHOT_DIR=` 옵션).
  운영 절차·한도·주의는 `docs/WAPPEN-RUNBOOK.md`. 마이그레이션 `supabase/migrations/20261006_wappen.sql` 은 **master 머지 전에** SQL Editor 에서 실행.
