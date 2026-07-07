# skills.md — GatherO(개더라운드) 프로젝트 작업 가이드

> 이 저장소에서 작업을 **효율적이고 정확하게** 하기 위한 실전 지식 모음.
> `CLAUDE.md`(규칙) + `CLAUDE_NOTES.md`(과거 실수 로그)와 함께 읽을 것.
> 이 문서는 2026-07-07 전체 기능 QA 결과를 반영한다.

---

## 0. 30초 요약 (새 세션 시작 시 이것부터)

- **단일 파일 SPA**: `index.html` 한 파일에 HTML+CSS+JS 전부 (~13,000줄). 인라인 `<script>` 블록은 3개, 실제 앱 로직은 2번째 블록(약 2,103~12,730줄, 10,600줄).
- **백엔드**: Supabase (DB + Auth + Edge Functions + Realtime). anon key는 클라이언트에 노출됨(정상).
- **서버리스**: Cloudflare Pages Functions (`functions/`) — 웹 푸시. Supabase Edge Functions (`supabase/functions/`) — 이메일/관리자검증/밴드결제.
- **호스팅 이중화 주의**: Cloudflare Pages(루트, 최신) + Firebase(`public/`, **오래된 스냅샷**)가 같은 DB를 봄. `public/index.html`은 구버전이므로 손대지 말고, 실제 앱은 루트 `index.html`.
- **파일 전체 Read 금지**. 항상 `grep -n`으로 라인 찾고 해당 부분만 Read (토큰 절약 + 함수 경계 파악).

---

## 1. 아키텍처 지도

### 1.1 최상위 화면 (screen) — 한 번에 하나만 보임
`_ALL_SCREEN_IDS`(index.html:6578)에 전부 등록. 전환은 `_hideAllScreens()`(6579) → 대상만 표시.

| 화면 ID | 진입 함수 | 용도 |
|---|---|---|
| `portal-page` | `showPortal` (6633) | 최초 진입, 5개 섹션 카드 |
| `landing-page` | `showGatheoSection` | GatheO 이메일/카카오 로그인·가입 |
| `landing-page-band` | `showBandSection` | 고정 합주팀 로그인·가입 |
| `landing-page-community` | `showCommunitySection` (7607) | 커뮤니티 모임 신청 |
| `main-content` | `_showGatheoMain` (6584) | GatheO 메인(예약/멤버/마이/활동/관리자 탭) |
| `band-main-content` | `renderBandPage` (10447) | 밴드 메인(정보/공지/팀/멤버/댓글) |
| `band-news-page` | `showBandNewsSection` (7402) | 밴드씬 뉴스(Google Drive) |
| `performance-booking-page` | `showPerformanceBookingSection` (6723) | 공연 대관 예약 위저드 |
| `pending-screen` | `showPendingScreen` (11160) | 가입 승인 대기 게이트 |
| `comments_container` | — | 자유게시판 |

> ⚠️ `showPendingScreen`(11160)은 일부 화면만 숨긴다. 새 화면을 추가하면 여기와 boot-hide 배열(3361/3372)도 갱신할 것. 안전하게는 `_hideAllScreens()` 먼저 호출.

### 1.2 GatheO 메인 탭 (`main-content` 내부)
`setGatheOTab`(2429)로 전환: **예약 / 멤버 / 마이페이지 / 활동(Drive갤러리) / 관리자**.

### 1.3 관리자 서브탭 (`gatheOTabAdmin`, 동적 렌더)
`renderAdminPage`(5232), `state.adminTab`으로 분기: **approval(승인) / members(멤버, CSV다운로드) / notice(공지) / blocks(시간차단) / bgm / polls(투표) / push(알림) / docs / perf(공연대관 관리)**.

### 1.4 상태 객체 (`state`)
`state.user`, `state.bandProfile`, `state.reservations`, `state.blocks`, `state.schedules`, `state.teams`, `state.bgmTracks`, `state.adminTab`, `state.communityEditAuth`.

### 1.5 역할 / 권한 (index.html:3256~3262)
- `isSuper()` = 운영 총괄
- `canApproveRes()` = 총괄/세션장
- `canCancelRes()` = 운영 총괄
- `isAdminUser()` = 총괄/세션장/운영총괄 (관리자 탭 노출)
- `isBandAdmin()`(10422) = `band_name_kr === '게더링'` ← **주의: 편집 가능한 표시명 기반, 권한 상승 취약**(§4 F1)

> **모든 권한 체크는 클라이언트 전용.** 실제 보안 경계는 **Supabase RLS**. 새 쓰기 경로 추가 시 반드시 RLS도 함께 설계.

---

## 2. 백엔드 지도

### 2.1 Supabase 테이블
`profiles`, `reservations`, `schedules`, `schedule_attendees`, `performance_bookings`, (+ community 모임/신청, band 공지/댓글/멤버/결제, polls, documents).

### 2.2 Supabase Edge Functions (`supabase/functions/`)
| 함수 | 역할 | 주의 |
|---|---|---|
| `verify-community-admin` | 커뮤니티 관리자 마스터 PW 검증 | `--no-verify-jwt`, rate-limit 없음(§4 F6) |
| `send-email` | Resend 이메일 프록시 | `--no-verify-jwt`, 인증 없음 = **오픈 릴레이 위험**(§4 F2) |
| `check-band-payments` | pg_cron 일일 밴드 미납 체크 → 푸시 | `--no-verify-jwt`, 응답에 밴드명 노출(§4) |

### 2.3 Cloudflare Pages Functions (`functions/`)
| 파일 | 역할 |
|---|---|
| `push.js` | VAPID 서명 + RFC 8291/8188 웹푸시 암호화. **HKDF는 WebCrypto `deriveBits` 1회만**(과거 이중추출 버그, 지금은 정상). 에러도 status 200 JSON. |
| `notify-admins.js` | service-role로 관리자 구독 읽어 `/push` 루프 호출 |
| `_middleware.js` | `?news=` 요청에 OG 태그 주입(카카오 미리보기). OG regex는 속성 순서/따옴표에 민감(index.html:28-29와 정확히 일치해야 함) |

### 2.4 부속
- `sw.js` — 서비스워커. **캐싱 없음**(push/notificationclick 핸들러만). `skipWaiting`/`clients.claim` 없음.
- `bgm-extension/` — Suno에서 BGM 목록 긁어 `music.json` 커밋하는 크롬 확장. GitHub PAT를 `chrome.storage.local` 평문 저장.
- `make_notice.py` — Pillow 공지 이미지 생성 (오프라인, 네트워크 없음).
- `manifest.json` / PWA 아이콘.

---

## 3. 반드시 지킬 코딩 규칙 (실수 방지)

### 3.1 날짜/타임존 (★ 가장 반복된 버그)
- **날짜(YYYY-MM-DD)는 반드시 `date.toLocaleDateString('en-CA')`** (로컬 시간대).
- ❌ `toISOString().slice(0,10)` — UTC라 자정 전후 하루 밀림. (`recordBandPayment` index.html:10539 등에 아직 잔존)
- ❌ `new Date('YYYY-MM-DD').getDay()` — UTC 자정 파싱, UTC-음수 지역서 요일 밀림. → `new Date(str + 'T00:00:00').getDay()` 사용.
- 타임스탬프(instant) 비교/저장에 `toISOString()` 쓰는 건 **정상**(예: `created_at` 비교, `localInputToIso`).

### 3.2 시간 슬롯 규약 (예약/차단 공통)
- `TIMES = ['10:00'...'22:00']` (index.html:3253), 10시 시작.
- **포함형 종료(inclusive-end)**: 1시간 예약은 `end_time === start_time`. 겹침 판정/검증에서 `>=`가 아니라 `>`를 써야 함. (`saveResEdit` 12086이 `>=`라 1시간 예약 편집 불가 — 버그)
- Postgres `time` 컬럼은 `HH:MM:SS`로 올 수 있음 → `TIMES.indexOf` 전에 `.slice(0,5)` 정규화.

### 3.3 XSS / 이스케이프 (★ 자주 놓침)
- `escapeHtml`(4620) / `escHtml`(4862)는 **작은따옴표(`'`)를 이스케이프하지 않음** (`& < > "`만).
- `escAttr`(4863)만 `'`와 `"` 둘 다 처리.
- **규칙**:
  - innerHTML 텍스트 삽입 → `escapeHtml(x)`
  - `onclick="fn('${x}')"` 같은 인라인 핸들러 속성 → **절대 문자열 보간 금지**. `data-*` 속성 + 위임 리스너, 또는 최소 `escAttr`. (이름에 `'` 들어가면 깨지고 주입됨)
  - 사용자 입력이 admin 화면에 뜨는 경로도 **저장형 XSS** 대상 (승인 대기 목록의 `user_name` 등).
- `marked.parse()` 출력은 반드시 `DOMPurify.sanitize()` 거칠 것 (`renderMarkdown` 11832는 이미 적용).

### 3.4 인라인 오류 메시지 규약 (CLAUDE.md)
- **로그인/가입/공연대관 폼**: `alert()` 금지, 폼 내부 result div 사용.
  - 패턴 div: `<div id="xxxResult" style="font-size:0.88rem;text-align:center;min-height:22px;padding:2px 0"></div>`
  - `const showErr = (msg) => { res.textContent = msg; res.style.color = '#e74c3c'; }`
  - 진입 시·폼 전환 시 `res.textContent = ''`로 stale 메시지 초기화.
- **성공 알림은 `showToast(msg)`** (index.html:12584). (단, `showToast` 타이머 미정리로 3.5초 내 연속 호출 시 조기 사라짐 — 주의)
- 밴드/커뮤니티/관리자 영역의 `alert()`는 CLAUDE.md 규약 범위 밖(허용)이나 UX 일관성상 점진 개선 권장.

### 3.5 Supabase 호출
- **`error`를 항상 확인.** `const { data, error } = await ...; if (error) { ...; return; }`.
  - `data || []`만 쓰고 error 무시하면: 조회 실패 시 "빈 결과"로 오인 → 달력 전부 빈 슬롯 표시, 겹침검사 무력화(중복예약 허용) 등 조용한 사고. (perf 흐름, `fetchBlocks`, `fetchReservations` perf 파트에 잔존)
- **낙관적 갱신 후 재조회**: create/delete/update 후 `fetchReservations()`/해당 fetch → render 호출해 목록·달력·관리자 목록 모두 갱신되는지 확인.
- **삭제-후-삽입 금지(트랜잭션 없음)**: `saveScheduleForDate`(4267)처럼 delete→insert는 insert 실패 시 데이터 유실. upsert 또는 삽입 우선.

### 3.6 Realtime 채널
- 재구독 전 반드시 `supabaseClient.removeChannel(ref)` (전역 변수로 참조 보관). 안 하면 "cannot add postgres_changes callbacks after subscribe()" 에러. (`subscribeToPolls` 12039는 정상 처리됨)

### 3.7 민감정보
- 도어락 번호, 전화번호, 관리자 연락처, Wi-Fi 위치 등은 **관리자 UI에서만, 그것도 서버(RLS)에서 가져와** 노출. **클라이언트 소스에 하드코딩 금지** (view-source로 전원 노출됨). → `generateApprovalMessage`(7233), `applyAdminDataFixes`(12369)가 위반 중(§4 F0/F4).

---

## 4. 알려진 이슈 (2026-07-07 QA) — 작업 시 참고/수정 대상

우선순위 높은 것부터. 라인 번호는 이 커밋 기준(변경 시 grep 재확인).

### CRITICAL / 보안
- **F0 도어락·PII 하드코딩** — `generateApprovalMessage`(7233)에 현관 코드/관리자 전화번호가 클라이언트 JS·공개 repo에 그대로. → RLS 테이블/Edge Function으로 이전.
- **F2 `send-email` 오픈 릴레이** — 인증·발신자검증 없음, `body.from` 스푸핑 가능. → 공유시크릿/JWT + `from` 하드코딩 + 수신자 화이트리스트 + rate-limit.
- **F1 밴드 관리자 권한 상승** — `isBandAdmin()`(10422)이 편집 가능한 `band_name_kr==='게더링'` 기반. 아무 팀이나 이름을 "게더링"으로 바꾸면 관리자 패널 획득. → 불변 서버 플래그/role + RLS, 예약어 차단.
- **F5 BGM PAT 평문 저장** — `bgm_admin_pat` localStorage. XSS와 결합 시 사이트 repo에 임의 커밋 가능. → 서버 프록시.
- **커뮤니티 편집/삭제 클라이언트 검증만** — `password_hash/salt`를 `select('*')`로 클라에 노출, 콘솔로 우회 가능. → `verify-community-admin` 서버 검증 + RLS, 해시 미전송.
- **notify-admins / push / check-band-payments** 인증 없음(CORS `*`) — 스팸·정보노출. → 동일 오리진 CORS + 내부 공유시크릿.

### 저장형 XSS (사용자 이름/입력 → innerHTML/인라인 onclick)
- **F2(예약) 승인 대기 목록** `user_name` 미이스케이프 — index.html:5806 (`(${r.user_name})`). 바로 아래 승인 목록 5853은 이스케이프됨. → `escapeHtml`.
- `renderDay` 취소 confirm에 `user_name` 원문(6298), 전화 복사 onclick(6026), 악기 배지(5079), Drive 폴더/파일명(2518, 7462), 커뮤니티 제목 onerror(7886/8108) 등 — `'`/`"` 주입. → `escAttr`/data속성+위임.

### 기능 버그
- **1시간 예약 편집 불가** — `saveResEdit` 12086 `>=` → `>`.
- **관리자 예약 편집 시 겹침/차단 미검증** — `saveResEdit`(12079)에 `getBlock`+겹침검사 추가.
- **차단 편집 시 겹침 미검증** — `saveBlockEdit`(5667)에 `timeBlocksConflict` 추가(add 경로만 902e38d로 처리됨).
- **취소된 예약이 공연대관 달력 영구 차단** — `loadPerfRangeConflicts`(6688)가 `rejected`만 제외, `cancelled` 미제외. → `.neq('status','cancelled')` 추가.
- **공간 설명 편집이 localStorage에만 저장**(6792) — 다른 기기서 반영 안 됨. → Supabase persist.
- **커뮤니티 진입이 `state.reservations` 오염**(7633) — 슬림 projection으로 덮어써 이름 `?` 표시.

### 잔존 타임존
- `recordBandPayment`(10539) `toISOString().slice(0,10)`, `saveBlockEdit`(5681)/`calcPerformanceFee`(7082) `new Date(YYYY-MM-DD).getDay()`.

### UX/누수
- Drive 비디오 오버레이 터치 리스너 매 탐색마다 누적(2828), 동시 다운로드 시 고정 id 충돌(2689), `showToast` 타이머 미정리(12584), 오버레이가 히스토리 미연동(뒤로가기 시 밑 화면 전환).

> 전체 상세는 `docs/QA-2026-07-07.md` 참조.

---

## 5. Git 작업 절차 (CLAUDE.md/CLAUDE_NOTES.md 요약)

1. **작업 전 항상 fetch** — stale한 `origin/` 추적 참조 신뢰 금지:
   ```bash
   git fetch origin <branch>
   git log --oneline origin/<branch> -5
   ```
2. 커밋 서명: `git config user.email noreply@anthropic.com && git config user.name Claude`
3. push는 PAT를 URL에 직접(프록시 우회). 로컬 프록시는 read-only.
   ```bash
   git push "https://<PAT>@github.com/wearegatheo-netizen/gatherallaround.git" <branch>
   ```
4. push 막히면 권한만이 아니라 **divergence(non-fast-forward)** 도 의심. `git rev-list origin/<branch>..HEAD --count`, `git merge-base --is-ancestor origin/<branch> HEAD`로 ff 가능 확인.
5. 배포: 작업 완료 후 master에도 머지·push. ff 가능하면 `git merge --ff-only`, 뒤처졌으면 cherry-pick으로 새 커밋만 얹기(CLAUDE_NOTES §7).
6. 지정 개발 브랜치를 벗어나 push 금지.

---

## 6. Edit 안전 수칙 (단일 대형 파일)

- `old_string`에 함수 선언을 포함했으면 `new_string`에도 **반드시 유지**. 삭제하면 함수 본문이 노출되어 SyntaxError → JS 전체 먹통(로그인 포함). (CLAUDE_NOTES §5)
- Edit 후 함수 경계 확인: `grep -n "^        function " index.html`.
- 중복 문자열 주의 — `replace_all:false` 기본이므로 `old_string` 유일성 먼저 확인.
- **변경 후 검증**: 인라인 스크립트 문법 체크(네트워크 불필요):
  ```bash
  python3 -c "import re;h=open('index.html',encoding='utf-8').read();[open(f'/tmp/b{i}.js','w').write(b) for i,b in enumerate(re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>',h,re.S))]"
  for f in /tmp/b*.js; do node --check "$f"; done
  ```

---

## 7. 로컬 검증 / 스모크 테스트

- **정적 서버**: `python3 -m http.server 8899 --bind 127.0.0.1` (repo 루트).
- **주의**: 이 실행 환경은 외부 CDN(jsdelivr, kakaocdn) 및 Supabase가 네트워크 정책으로 차단됨. → SDK 로드 실패 상태로만 테스트 가능. 로그인·DB 실동작은 실 배포 환경에서 확인.
- **오프라인으로 검증 가능한 것**: 인라인 스크립트 문법, 포털→각 섹션 화면 전환(정확히 한 화면만 표시), 전역 함수 존재 여부, 콘솔/pageerror.
- Playwright는 사전 설치됨(`/opt/pw-browsers`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). `playwright-core`로 headless_shell 직접 실행:
  ```js
  chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' })
  ```
- SDK가 null일 때 `.from()`/`.auth` 호출로 TypeError 나는 경로 있음(오프라인 한정). 새 코드엔 `if (!supabaseClient) return;` 가드 권장.

---

## 8. 작업 체크리스트 (기능 추가/수정 시)

- [ ] 날짜는 `toLocaleDateString('en-CA')`? 요일은 `+'T00:00:00'` 파싱?
- [ ] 사용자 입력이 innerHTML/인라인 onclick에 들어가면 `escapeHtml`/`escAttr`/data속성?
- [ ] Supabase `error` 체크했나? 실패 시 사용자에게 알리고 중단?
- [ ] 쓰기 후 관련 목록/달력/관리자뷰 재조회·재렌더?
- [ ] 새 쓰기 경로면 Supabase RLS로도 막았나? (클라 권한체크만으론 부족)
- [ ] 폼이면 result div + showErr / 성공은 showToast?
- [ ] 시간 슬롯은 inclusive-end(`>` 비교, `.slice(0,5)` 정규화)?
- [ ] 새 화면이면 `_ALL_SCREEN_IDS` + boot-hide 배열 + `_hideAllScreens` 경유?
- [ ] 민감정보를 클라이언트 소스에 하드코딩하지 않았나?
- [ ] Edit 후 `node --check`로 문법 통과? 함수 경계 온전?
- [ ] fetch → 커밋(서명) → 지정 브랜치 push → master 배포?
