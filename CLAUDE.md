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
  **포스터 꾸미기 작품을 공연 포스터로**(2026-10-13): 공연 등록 폼 [🎨 포스터 꾸미기에서 가져오기](`openWappenPosterPicker`) — 같은 출처라 `localStorage.wappen_session` 을 그대로
  `/wappen-api {action:'my_content', session}` 에 보내 내 작품(`preview_url` 있는 것)을 격자로, 고르면 `_hostState.posterUrl` = 미리보기(1080px JPEG) URL(`pickWappenPoster`, `#evPosterPreview` 썸네일).
  세션 없음/401 → 로그인 안내 + [포스터 꾸미기 열기](새 탭). 서버 `posterOk`(event-api)는 `community-images/events/` 와 `wappen/previews/` 두 접두만 허용(`POSTER_PREFIXES`).
  **공연 공유**는 경로형 `/show/<id>`(`functions/show/[id].js`) — 크롤러(kakaotalk-scrap 등)에는 포스터·제목·일시 OG 페이지, 사람에게는
  루트 셸에 `<base href="/">`+`history.replaceState('/#shows/<id>')` 를 넣어 200 으로(302+해시 금지, 인앱이 해시를 버림). 상세 [🔗 공유] = `shareShow(id)`
  (navigator.share → 클립보드 폴백). 숨김 공연은 기본 OG. index.html 머리 스크립트가 `/show/<id>` 정적 폴백도 해시로 치환. 셸 자산은 절대 경로만 쓸 것(`/vendor/…`).
- **공연 예매·공간 대관·호스트 센터 머리·레이아웃(2026-10-16, 커뮤니티·게더링 개편 반영 — 탭 성격별로 다르게)**: 세 화면 모두 큰 제목 헤더(`.perf-header`, 삭제됨) 대신
  **앱 바 `.sec-bar > .cm-bar`**(뒤로 `.cm-ib`·KkuBulLim 제목·`.cm-pill`·SVG 모드 버튼 `theme-toggle-svg` — `applyTheme` 가 textContent 를 건드리면 안 됨; 폭은 `.w1100`(대관)/기본 920(공연)/`.w720`(호스트)).
  **공연 예매**(두둥식 발견·전환): 포스터 격자 `.show-grid` 유지(2열/≥600px 3열/≥900px 4열) — 카드 칩은 포스터 왼쪽 위(`_sxChip`, `.cm-chip d/ok/warn/sold/closed`, `_seatInfo().cls`), 지난·마감은 `.closed` 흐림.
  목록은 알약 탭 `#showsListTabs .cm-seg`(다가오는/지난 + 수) → 한 줄 `.sx-sub`(「다가오는 N개 · 예매 가능 N개」 + [호스트 센터] 링크, ≤480px 은 안내문 숨김) → 검색 `.sx-search` → 격자; [내 티켓 조회]는 앱 바 알약 `#showsTicketBtn`.
  상세 = 커뮤니티 상세 골격: `.cm-top`([‹ 공연 목록]·[공유]) → `.cm-hero.sx-hero`(포스터 `.sx-poster` 3:4, ≥768px 왼쪽 320px) → `.cm-eyebrow`(D-day·잔여석 칩 + `_showDateLong`) → `.cm-title` → `.cm-place` →
  `.cm-stats`(가격·잔여석/정원·예매 마감|오픈) → `.cm-rows`(주최·장소(+지도 링크)·결제) → `.cm-sec` 주최 팀(`.sx-host`)·오시는 길(`#showMap`)·공연 소개(`.cm-desc.docs-card-content`) → **고정 바 `.cm-sticky`**(가격 + [예매하기] `#showBookOpenBtn`, 불가면 비활성 라벨).
  예매 폼은 `#bookSheetWrap.cm-sheet-wrap.hidden`(DOM 에 미리 있음, 입력 id 종전 `showName/showPhone/showQty/showAnswer-i/showPrivacyAgree`) — `openBookingSheet()` 가 hidden 제거+`.on`+`body.cm-sheet-open`+Esc, `closeBookingSheet()` 는 popstate·`_hideAllScreens` 도 부른다.
  `_sxSheetReset()` 을 목록·상세·티켓 화면 머리에서 불러 스크롤 잠금이 남지 않게. 티켓 조회는 `.cm-form`(`findCode/findPhone`).
  **공간 대관**(예약 퍼널): 단계 표시 `_perfStepsHTML(1|2|3)`(`.sx-steps`, 조회 화면엔 없음) → 달력 카드 `.gt-card`(머리 `.perf-cal-head`: 알약 `.gt-seg` [월간|주간] — id `perfCalMonthBtn/WeekBtn`·`.active` 토글은 `setPerfCalView` 그대로 + ‹ › 원형 `.perf-cal-nav`)
  → 인원 카드 `#perfHeadcountSection` → 공간 소개 카드 → 요금 띠 `.cm-stats.sx-rate`(평일/주말/최소 3시간 + `.sx-note`) → `<details class="sx-acc">` 유의사항·환불 규정(접힘, summary 에 요약).
  범위가 완성되면 **고정 바 `#perfStep1Next.cm-sticky`**(`#perfStickyFee` = 날짜·시간 / 금액·시간·인원, `renderPerfFee` 가 채움; `_perfCalOnChange` 가 flex 로 켜고 `#perfStep1Pad` 도 함께, 처음 완성 때 인원 카드로 `scrollIntoView`).
  2단계는 `[‹ 날짜·시간 다시 선택]` + 요약 띠(`#perfSummaryHeadcount` 는 「N명」만, 관람객 미정은 `#perfSummaryTbd`) + 폼(제출 버튼 하나), 조회는 `.cm-form`. 앱 바 알약 `#perfLookupTopBtn`.
  **호스트 센터**(관리 콘솔): 알약 탭 `_hostTabBar()` → `.cm-seg`(공연 관리/팀 관리), 요약은 `.gt-tiles`(예정 공연·예매 매수(대기)·확정 매출), 로그인 카드 `.host-card.sx-login`, 폼 머리 [‹ 대시보드]는 `.cm-top`.
  `.host-card` 는 gray-200·16px 로 통일. 캡처 scratchpad `shows/shoot-after.js`(`W/H/OUT/TAG/DARK`), 테스트 `tests/ui-shows.js`(알약 탭·앱 바 알약 확인)·`tests/ui-host.js`.
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
- **포털(2026-10-08 개편, 10-09 포토 마스트헤드)**: 카드 맨 위를 공간 사진이 꽉 채우고(4:3, `#portal-page` 패딩만큼 음수 마진 — 모바일 16/14px 과 짝) 그 위에
  흰 워드마크(`.portal-brand` 1.3rem)·유리 모드 버튼(`.portal-hero-toggle`, SVG 달/해를 `body.dark` 로 전환 — `applyTheme` 가 이 버튼 textContent 를 건드리면 안 됨),
  아래쪽에 헤드라인 "밴드를 위한 아늑한 공간"(`.portal-hero-cap b` 1.45rem/모바일 1.35rem)+한 줄 설명, 점은 사진 바닥 가운데. 별도 상단 줄·태그라인 줄·분리선 없음
  (레퍼런스: 당근·토스식 얇은 바 vs 호텔·스튜디오식 포토 마스트헤드 중 후자 채택, 시안 A~G 거쳐 F). 그 아래 「누구나 이용」 타일 2×2(커뮤니티=파란 강조·공간 대관·공연 예매·와펜)·
  「멤버 전용」 점선 패널(게더링·고정 합주팀, 글 좌측 정렬)·바닥 연락처(인스타그램 `PORTAL_INSTAGRAM_URL` 비면 숨김, [전화 문의]=`copyPortalPhone()` 번호 복사+토스트, 실선 구분·회색 알약).
  타일/패널 버튼(`.portal-tile`/`.portal-mbtn`/`.portal-pill`)은 포털 전용 컴포넌트로 gaa-btn 의 의도적 예외. 히어로는 `initPortalHero()` 가 `PERF_SPACE_PHOTOS` 와
  같은 이름의 **경량 WebP `img/portal/<이름>.webp`**(가로 960px, `tools/make-portal-hero.js` 로 생성 — 원본 0.7~3.6MB 금지)를 4초마다 크로스페이드,
  다음 장만 그때 내려받고 포털이 안 보이면 멈춤. 사진이 없거나 실패하면 숨기지 않고 `.noimg` 어두운 배경(워드마크·버튼·헤드라인은 남아야 함). 대관 사진을 추가하면 webp 도 같이 넣을 것.
  히어로 클릭 = 공간 대관(`role=button`, Enter/Space — `event.target===this` 로 버튼에서 올라온 키는 무시, 버튼은 click/keydown 전파 차단).
- 부팅 로딩 스크린(`#portalLoadingScreen[data-boot]`)은 `<body>` 머리에 **정적**으로 있고 바로 앞 인라인 스크립트가 저장된 다크 모드(`gaa_theme`)를
  body 에 즉시 적용(2026-10-08, 포털이 먼저 보였다 가려지는·라이트→다크 깜빡임 제거). 걷기는 `hideBootOverlay()` 한 곳 — 첫 페인트(`__bootT0`) 후
  최소 `BOOT_MIN_MS`(0.9s) 노출 + 글꼴 준비(≤0.5s) 뒤 페이드, 인증 판단이 끝나는 곳(loginUI/logoutUI/_finishBoot/showPendingScreen/공유·초대 진입)이 부르고
  어디서도 안 부르면 `BOOT_MAX_MS`(1.8s) 폴백. 섹션 진입용 `showPortalLoading()` 오버레이(같은 id, data-boot 없음)는 별개 —
  **포털 → 섹션 전환은 모두 로딩 화면**(2026-10-09): 공연 예매·공간 대관·멤버(세션 복구 직접 진입)는 `showSectionLoadingFromPortal()`
  (포털이 보일 때만, 부팅 오버레이가 덮고 있으면 생략 → 뒤로가기·목록↔상세 이동·부팅 딥링크엔 안 뜸; `_hideAllScreens()` 보다 먼저 호출),
  커뮤니티·로그인 폼 경로는 종전대로 `showPortalLoading()` 무조건, 와펜 타일은 `goWappen()` = `showPortalLoading({hold:true})`(자동으로 안 걷힘) 뒤 이동,
  bfcache 복귀는 `pageshow(persisted)` 가 섹션 오버레이를 치운다.
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
- 공간 대관 공간 소개 사진(`.perf-photo-gallery img`, 2026-10-14): 누르면 라이트박스 `#perfPhotoBox.perf-lb`(`perfPhotoOpen(i)/perfPhotoStep/perfPhotoClose`, z 10050) — 원본을 화면에 맞춰(contain) ‹ › 버튼·좌우 스와이프·←→ 키·Esc·배경 클릭·아래로 스와이프로 조작, `body.perf-lb-open` 스크롤 잠금, 다음 장 프리로드. 검증 scratchpad `perf-lb.js`.
- 공간 대관: 예약번호 6자리 `booking_code`(예매번호와 동일 charset, 클라 생성+unique 충돌 재시도),
  [예약 조회]는 anon select 후 연락처 대조. 4시간 자동취소는 크론 없이 lazy —
  `_pbExpired()`로 화면·가용성 계산에서 즉시 만료 취급 + 관리자 탭 진입 시 `status:'expired'` sweep.
  D-2 관리자 알림: GitHub Actions 크론(매일 07:47 KST + 10:17 예비, `{scope:'booking'}`) → `/send-reminders`
  (`reminder_sent_at` 선점으로 건당 1회, 놓친 날은 D-1/D-DAY 캐치업, 푸시는 `/notify-admins` 재사용).
- **커뮤니티(2026-10-13 개편, 시안 A·절제형 발전안)**: 머리는 앱 바 `#communityBar`(`.cm-bar`: 뒤로·제목·[신청 조회] 알약·SVG 모드 버튼 `themeToggleBtnCommunity` — `applyTheme` 가
  textContent 를 건드리면 안 됨) + 알약 탭 `communitySegHTML(tab)`(테스트 탭도 공용) + 한 줄 요약(`#communityVisitorCount` "오늘 N명 방문"). 앱 바는 목록·테스트 탭에서만,
  상세·신청 조회에선 `communityBarVisible(false)`. 목록은 **날짜별 타임라인**(`.cm-tl > .cm-grp > .cm-day + .cm-ev`, 루마 lu.ma 식) — 모집 중은 가까운 날짜순·D-day 칩,
  지난 모임은 최근순·회색 점. 카드 `_cmEventCardHTML(m)`: 시간·모집중/마감/무료 칩·제목·모임장 이니셜·장소·정원·참여비, 썸네일은 글 상자 높이의 정방형.
  **신청 인원(N/정원)은 비공개**(`COMMUNITY_SHOW_APPLICANT_COUNT=false`, 모임장은 [신청자 관리]에서). [모임 만들기]는 떠 있는 `.cm-fab`(BGM 바 56px 위).
  상세(`renderCommunityDetail`): `.cm-top`([‹ 목록으로]·[공유]·[수정]) → `.cm-hero`(사진 `.cm-cover` 16:9 / 데스크톱 ≥768px 은 사진 왼쪽·정보 오른쪽 2단) →
  `.cm-eyebrow`(모집중/모집 마감 칩 + "M월 D일 (요일) 시간") → `.cm-title` → `.cm-place` → 요약 띠 `.cm-stats`(참여비·정원·신청 마감, 마감일 없으면 "모임 당일") →
  `.cm-rows`(모임장: 이니셜·이름·[문의하기]=`tel:` 링크로 번호 비노출 / 준비물) → 설명(`.cm-desc`, **항상 전부 표시** — 접기 없음, 2026-10-13) →
  아래 고정 바 `.cm-sticky`(참여비 + [참여 신청하기], 마감이면 비활성; iOS 때문에 fixed 요소에 backdrop-filter 금지). 본문 폭 920px 제한(3열 그리드 폐기).
  **신청서는 본문에 없고** [참여 신청하기] → `cmApplySheetOpen()` 이 `state.communityApplyFormHTML`(`cmApplyFormHTML`) 을 바닥 시트 `#cmApplySheet`(`.cm-sheet-wrap`, z 10001,
  데스크톱 ≥768px 은 가운데 모달 560px)에 넣는다. 닫기 = ×·배경·Esc·popstate·`_hideAllScreens`·상세 재렌더(`cmApplySheetClose`). 시트는 body 직속이라
  신청 폼 CSS 는 `#communityContent` 가 아니라 **`.cm-form .cm-f …`** 로 범위(입력 id 는 종전 `ca_name/ca_phone/ca_custom_i`, 44px 상자형 — 전역 `input[type=text]{height:52px}` 보다 특이도 높임).
  옛 `.community-card/.community-grid/.community-tab*/.community-detail-hero*` CSS 는 제거됨(`community-grid-2`·`gforms-*` 는 생성/수정 폼이 계속 씀).
  대표 이미지는 **정방형**: 만들기/수정에서 파일을 고르면 크롭 상자(`cmCropLoad/Zoom/Reset/Export`, 끌어 이동·1~3배 확대)로 보일 영역을 정하고 제출 때 1080² JPEG 로 잘라 올린다.
  테스트 탭(`communitySetTab('test')`)은 성향 테스트 2종만 — 리듬·멜로디 게임은 2026-10-13 삭제(`game_scores` 테이블만 남음).
  **신청폼 질문**(`form_fields` JSON, 2026-10-13 확장): `{label, type:text|textarea|select|multi|consent|note, required, placeholder, options[], limits{선택지:정원}, showIf{field:질문 label, value}, text}`.
  `note` = 입력칸 없는 안내문(답·필수·조건 없음, CSV·집계 제외). 신청 폼은 질문 번호 칩(안내문 제외)·머리글에 질문 수, 검증 오류는 알림창 대신 `cmFieldError()`(칸 빨간 테두리+문구+스크롤),
  연락처는 `cmPhoneFmt` 자동 하이픈, 장문은 `cmGrow` 자동 늘어남, 선택한 체크 칸은 `:has(:checked)` 강조. 목록 카드 썸네일은 `_cmFitThumbs()` 가 **왼쪽 글 상자 높이의 정방형**으로 맞춘다(그린 뒤 측정, 최대 3회 반복, resize 때 재조정; CSS 기본 96px).
  답변 `form_data[label]` = 문자열 / multi 배열 / consent `'동의'|''`; 조건으로 숨겨진 질문은 저장 안 함. 편집기는 만들기('cc')·수정('ce') 공용 `cmQEditorHTML(k)`
  (선택지는 행 단위 + 정원 칸, Enter 로 다음 선택지, ↑↓·복제·삭제, 표시 조건 = 다른 선택/동의 질문의 답). 저장 전 `cmCleanFields` + `cmFieldsProblem`(중복 질문명·선택지 없음 차단).
  신청 폼 `cmApplyFieldsHTML`: 정원 찬 선택지는 "(마감)" 비활성(`cmOptionCounts` 거절 제외), `cmApplyCond()` 로 조건 표시, 제출 직전 정원 재확인.
  신청자 관리 탭 「답변 집계」 `cmAggregationHTML`(2026-10-14 간소화): 접힌 `<details class="cm-agg-wrap">`(요약에 N명 기준·질문 수), 질문마다 선택지 「이름 N(/정원)」 칩 한 줄(`.cm-agg-row`, 0명 `.zero` 흐림·정원 참 `.full` 주황, 막대 없음), 텍스트 질문은 답변 수만.
  **모임 설명은 서식 HTML**(2026-10-14): 만들기/수정이 `docEditorHTML('cc_desc'|'ce_desc', …, {image:true})` — 공연 소개와 같은 편집기에 🖼 사진 버튼(`rteImage`: `_rteShrink` 긴 변 1600px JPEG → `uploadCommunityImage` → `<img>`),
  링크는 🔗(`rteLink`). 저장은 `rteValue()`(DOMPurify, 없으면 `_htmlSanitizeFallback`), 표시는 `.cm-desc` 에 `renderMarkdown()` — 옛 평문 설명도 같은 경로(줄바꿈·자동 링크). CDN 미로드 폴백도 HTML 이면 최소 살균으로 그대로 보인다.
  CSV·메일은 `cmAnswerText`(배열은 ", " 연결). 질문명이 form_data 키라 **질문명 변경 시 과거 답변과 끊김** — 편집기는 showIf 참조만 따라간다.
  검증은 scratchpad `cm/test.js`(Playwright, 가짜 supabase 시드 — `community_meetings`·`community_applications`·`time_blocks` 데이터, `.eq('status')` 만 흉내, 나머지 빈 결과).
  **게더링 차단 시간 사용 요청(2026-10-13)**: 모임 만들기 달력은 `_calCtx.allowBlocked=true` — 예약·대관(`getHardConflicts`)만 '예약불가', `time_blocks` 는 `.slot-request` '요청' 칸으로 고를 수 있다
  (월간은 차단만으로 꽉 찬 날도 클릭, `dateHardStatus`). `checkCommunityTimeConflict` 는 `{kind:'reservation'|'block'|'invalid', message, range, reason}` 를 돌려주며 예약·대관이 차단보다 우선
  (`fetchCommunityReservationsAndBlocks` 가 `performance_bookings` 도 가상 예약으로 합침). `submitCommunityCreate`: 차단과 겹치면 확인창 → **`status:'pending'`** 으로 저장(time_blocks 안 넣음), 아니면 `active`+time_blocks.
  둘 다 `sendAdminPush(title, body, {roles:['운영 총괄']})`(배너 푸시 — `/notify-admins` roles). 공개 목록(`fetchCommunityMeetings`)은 `(status||'active')==='active'` 만.
  운영 총괄의 **공간대관 탭 머리** `_cmReqSectionHTML()`(🙋 요청 N건, 차단 사유 `_cmReqBlocks`, [수락][거절] → `reviewCommunityMeeting`) → `functions/community-admin.js`
  `{action:'review_meeting', meeting_id, decision, kakao_token|sb_token}`(service role; anon UPDATE 가 회수된 테이블이라 서버만 가능). 인증 `_adminApiAuth()`: 카카오 토큰 → Supabase 세션 → 캐시 세션이면 카카오 팝업 재발급.
  서버는 kapi/GoTrue 검증 후 `profiles.role='운영 총괄'`(카카오 `ADMIN_KAKAO_ID` 백스톱), `status=eq.pending` 조건 PATCH(경합 409), 수락 시 `time_blocks` 1행(`meetingSlots` 로 "10:00 ~ 13:00" 역변환)
  + 모임장 Resend 메일(키 있을 때만). 마이그레이션 `20261013_community_meeting_status.sql`(status/reviewed_at) 미실행이면 요청 생성·탭이 안내 문구로 알려준다. 단위 테스트 `tests/community-admin-unit.mjs`.
- **게더링 멤버 페이지(2026-10-15 개편, 시안 B 「홈 중심」)** — `#main-content`. 앱 바 `.gatheo-topbar`(홈=워드마크 `#gtBarWm`, 다른 탭=제목 `#gtBarTitle`(`_GT_TITLES`),
  관리자 톱니 `#gatheoTab-admin`(id 는 종전 그대로 — loginUI/logoutUI 가 hidden 토글), SVG 모드 버튼 `#themeToggleBtn.theme-toggle-svg`(`applyTheme` 가 textContent 를 건드리면 안 됨),
  아바타 버튼 `#gtAvatarBtn` → 마이; `gtUpdateBar()`). 하단 탭 **홈·예약·멤버·게시판·마이** 5개(`_GATHEO_TABS` 에 `home`, 기본 탭 `home`, 관리자는 탭이 아니라 톱니+마이 목록 줄).
  **홈** `renderGatheoHome()`(`#gatheOTabHome`): 인사(이번 주 합주·내 예약·새 글 수) → 다음 합주 큰 카드 `#gtNextSched`(날짜 단위, 참석자 아바타 `_gtDateAttendees` = 날짜/그룹/슬롯 신청 합집합,
  내가 신청했으면 「참석 확정」 칩, 버튼은 `openScheduleForDate`) + 내가 신청한 다른 날짜가 있으면 「내 다음 참여 일정」 줄 → 내 다음 예약 `#gtNextRes`(멤버 아바타·[멤버 수정]) → 공지 한 줄 `#gtNotice`(접힘, 누르면 전부)
  → 바로가기 4(`.gt-qa`) → 게시판 새 글 3(`gtOpenPost`). 데이터 갱신은 `gtHomeRefresh()`(render()/공지/일정/댓글 fetch 끝에서 호출, 60ms 디바운스). 옛 `#notice_container`·`#schedule_banner` 는
  숨긴 채 데이터만 유지(renderNotices 가 다시 보이게 하지 않음; 공지 편집은 관리자 탭).
  **예약** 탭: 내 예약 줄 `#gtMyResRow`(`gtUpdateMyResRow` 승인/대기 칩 → 마이 › 내 예약) → `.gt-seg` 알약 [월간|주간](`.tab[data-view]` 는 종전 onTabClick 그대로, 달력 안 「내 예약」 탭은 제거) + [ⓘ 예약 안내]=`gtRulesSheet()`
  → 달력 카드(`.gt-card`, 월간에 내 예약은 `.cal-day-info .mine` 파란 칩, 범례 `.gt-leg`) → 참여 멤버 카드 → 제출. 공용 바닥 시트 `gtSheetOpen(title, html)/gtSheetClose()`(커뮤니티 `.cm-sheet` 스킨 재사용, `_hideAllScreens` 가 닫음).
  **멤버** 탭: 알약 `#memberSeg .seg-btn[data-tab]` 멤버(수)/팀(수)/일정표/참여횟수(`setMemberTab` 이 `.on` 토글, `_MEMBER_SUBTABS` 의 docs/activity 는 딥링크 호환용으로만 남음), 멤버 카드 `.mlist-card` 앞에 `gaAvatar`,
  팀 카드는 수정/삭제 버튼 대신 `.team-more` ⋯ → `gtTeamMenu` 시트, 멤버 아바타 묶음 `.gt-stack`. **게시판**: 제목은 앱 바, `#main-content #comments_container` 평면, 글쓴이 아바타(`_gtMemberByKakao`).
  **마이** `renderMypagePanel()`: 프로필 카드 `.gt-prof`(아바타·역할 칩·세션 칩·[수정]) → 숫자 타일 `.gt-tiles` → 설정형 목록 `.gt-list`(내 예약·음악 취향·연락처·소속 팀·운영안내·활동 앨범·관리자(관리자만) / 푸시 알림·다크 모드·로그아웃).
  하위 화면 `gtMypageSub('res'|'taste'|'docs'|'activity')` → `renderMypageSubView()`(`state.mypageSub`, 머리 [‹]; `renderMypagePanel` 은 mypageSub 가 있으면 하위 화면을 그리고 끝 — 탭 전환의 비동기 렌더가 덮지 않게).
  운영안내 분류 버튼의 `render()` 호출은 하위 화면에서 `renderMypageSubView()` 로 바꿔 붙인다. 내 예약 목록은 종전 `renderMyPage(container)`(pager 는 `changePage('myRes')` 가 마이에서 하위 화면을 다시 그림).
  **아바타**: `gaAvatar(name, {url, cls})` — url 있으면 `.ga-avatar.img`(background-image), 없으면 이름 이니셜. `profiles.avatar_url`(마이그레이션 `20261015_profile_avatar.sql`) 기본값은 **카카오 프로필 사진**
  (`handleLogin` 이 `select('*')` 로 읽고 비어 있으면 thumbnail/profile_image_url 을 저장, `state.user.avatarUrl/kakaoAvatar`), 마이 › 수정 「프로필 사진」 [사진 바꾸기]=`gtAvatarPick`(가운데 정방형 256px JPEG →
  `community-images/avatars/<profile>-<ts>.jpg` → `gtAvatarSave`) / [카카오 사진으로|기본(이니셜)으로]=`gtAvatarReset`. 멤버 목록·팀·홈 참석자·게시판·앱 바가 같은 부품을 쓴다.
  **팀장·참여자 명단 보기(2026-10-16)**: 팀 구성 폼의 슬롯 줄마다 👑 라디오(`.slot-leader`, `setTeamLeader(idx)`) — 팀장은 **`teams.members` JSON 슬롯의 `leader:true` 한 명**(컬럼·마이그레이션 없음,
  `saveTeam` 이 `{session, memberId, leader}` 로 정규화·둘 이상이면 첫 번째만, `teamLeaderId(t)`). 팀 카드는 팀장 칩 `.team-slot.leader`(👑, 호박색) 을 맨 앞에·아바타 묶음도 팀장 먼저,
  일정 편집기가 팀 멤버를 복사할 때(`members[].leader`)와 일정 슬롯 멤버 칩도 👑. 일정표 참여자 명단(그룹 `#grp-att-…`·슬롯 `#slatt-…` 패널)은 `_attPanelHTML(ids, {myId, teamId})` —
  알약 `.gt-att-seg` [이름|세션별|팀장별](`state.attMode`, 기본 세션별) 을 누르면 `gtAttMode()` 가 **모든 `.gt-att` 패널을 data-ids 로 제자리에서 다시 그림**(재요청 없음).
  세션별 = 프로필 `instruments` 첫 악기(보컬·기타·베이스·키보드·드럼 순, 없으면 「미지정」), 팀장별 = 진행 중 팀(`isPastTeam` 제외)별 「👑 팀장 · 팀명 N」(슬롯의 `team_id` 팀 먼저, 여러 팀이면 각각 표시, 나머지 「소속 팀 없음」).
  칩 `.gt-att-chip`(아바타+이름, 나는 `.me` 파란 채움). 캡처 `gatheo/shoot-att.js`.
  **이동 뒤 포커스(2026-10-19)**: 다른 탭·폼으로 보내는 동작은 전부 `gtFocus(target, {focus, flash, block, ifHidden, tries})` 를 거친다 — 요소가 그려질 때까지(100ms×30) 기다렸다가 앱 바 아래(70px)로 스크롤,
  `.gt-flash`(파란 테두리 1.7초) 강조, `focus` 선택자는 포인터 기기에서만 포커스, `ifHidden` 이면 이미 다 보이는 요소는 스크롤 안 함. 적용: 홈 [일정 보기]·「내 다음 참여 일정」·배너 줄 → `openScheduleForDate` 가 지난 날짜면 `scheduleFilter='past'`
  로 바꾸고 날짜 카드 `#schedDay-<date>` 로 / 홈 새 글 `gtOpenPost` 는 게시판 fetch 를 기다려 글을 펼치고 `.board-row-wrap` 으로 / 팀 [팀 수정]·[새 팀] → 목록 위 폼 `#teamFormContainer` 로 + `#teamName` 포커스, 저장 뒤엔 그 팀 카드 `#team-<id>` 강조 + 토스트 /
  관리자 일정 [편집]·[+ 새 일정 추가] → `#schedEditor`, 저장 뒤엔 저장한 날짜 카드 / 예약 탭은 월간 날짜 클릭 → 주간 시간표(`#viewContainer`)가 화면 밖이면 거기로, 시작·끝 칸으로 범위를 완성하면 `#participantSection` 이 화면 밖일 때만 가운데로.
  모달(멤버 수정)·인라인 편집(공지·멤버 정보)·마이 하위 화면은 원래 제자리라 손대지 않음. 검사는 `gatheo/test.js` 2b·3c·4c·5b·9c.
  **탭 전환 체감(2026-10-16, stale-while-revalidate)**: 멤버 하위 화면 4종·마이는 마지막 HTML 을 `_gtViewCache` 에 두고 재진입 때 즉시 보여준 뒤 서버로 갱신(`renderMemberPanel` 이 캐시 주입·수거, 렌더러는
  `_gtPlaceholder(el)` 로 캐시 없을 때만 "불러오는 중"). 첫 진입도 로그인 때 받아 둔 `state.cachedMembers/teams/schedules`(+홈이 받아 둔 참석자)로 먼저 그린다 — 멤버 목록 `paint()`(서명 같으면 DOM 유지),
  팀 `paint()`(열린 팀 폼은 안 덮음), 일정표·마이는 `{quick:true}` 재귀 호출. 기다리는 동안 다른 하위 탭으로 옮기면 쓰지 않음(`state.memberPanelTab` 확인). `fetchScheduleAttendees` 는 요청 날짜 + 이미 받은 날짜(`state._attLoaded`)를
  합쳐 받고 응답 뒤 한 번에 상태를 바꾼다(홈·일정표·참여횟수가 서로 지우지 않게, 120일 초과면 요청분만). 로그아웃이 캐시를 비운다. 계측은 scratchpad `gatheo/probe.js`(탭별 요청 수·자리표시 노출).
  검증 scratchpad `gatheo/test.js`(Playwright, `gatheo/seed.js` 가짜 supabase — profiles/reservations(participant_ids)/schedules/schedule_attendees/documents/comments/teams, `.eq/.in` 만 흉내), 시안 목업 `gatheo/mock.html`, 캡처 `gatheo/shoot-new.js`(`W/H/OUT/DARK` 환경변수).
- 공용 시간표 달력: 대관 달력 렌더러(renderPerfCal/renderPerfMonth/renderPerfWeek/perfWeekSlotClick 등)는
  `_calCtx`{state, ids, minSlots, onChange} 컨텍스트로 구동 — 대관 페이지(`_perfCalCtx`, 최소 3슬롯)와
  커뮤니티 모임 등록 폼(`initCommunityCal`, 최소 1슬롯, 선택 시 cc_date/cc_start_time/cc_end_time 자동 입력)이 공유.
  달력 함수 안에서는 `_perfState` 대신 `_cs()`를 쓸 것.
- 테스트: `tests/` (event-api·send-sms·send-email·send-reminders·notify-admins·music-search·community-admin 단위, shows/host/band UI —
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

## 포스터 꾸미기 (`/wappen/`, 2026-10-06 — 서비스명은 2026-10-12 「와펜 꾸미기」→「포스터 꾸미기」로 변경, URL 경로·코드 식별자(wappen)는 그대로)
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
  **에디터 레이어 패널(2026-10-08)**: 서랍 머리의 `.seg` 탭 [와펜 N]/[레이어 N] — 붙인 순서 목록(위가 앞, `#n` = 붙인 순서, 위치·폭·각도 요약),
  행 클릭 = 캔버스 선택, 체크박스 다중 선택([전체 선택]/[선택 해제] 버튼). 순서 이동·반전·회전·삭제 버튼은 패널에 두지 않고(중복, 2026-10-08 요청)
  **캔버스 아래 도구 막대(반전·회전 | 맨 아래·한 칸 아래·한 칸 위·맨 위 | 복제·삭제)가 `targets()`(체크 선택 있으면 그 전체, 없으면 캔버스 선택)에 적용**:
  `editor.reorder(indices, 'front'|'forward'|'backward'|'back')`(상대 순서 유지, 새 인덱스 반환)·`applyTo(indices, fn)`(반전·회전)·`removeMany`. 체크 선택이 있으면 캔버스 선택이 없어도 막대를 보인다(모바일은 버튼 34px 로 9개 한 줄).
  [전체 선택]/[선택 해제]·선택 수는 서랍 머리(레이어 탭일 때 검색창 자리). 패널은 한 줄 `.ed-nudge`(X/Y 중심 px 입력 `setPos` + ↑↓←→, 단계는 화면 10px 고정 = `stepNow()`,
  누르고 있으면 60ms 반복 — `beginBatch()/endBatch()` 로 실행 취소는 한 번에) + 목록뿐(설명글·단계 칩 없음, 2026-10-08 요청).
  패널 갱신은 `onChange/onSelect` → `renderLayers()`(레이어 탭일 때만 그림).
- **공유 링크는 경로형** `https://gatherallaround.com/wp/<프로젝트>`·`/ww/<작품>`(`shareUrl()`) — Pages Function `functions/wp/[id].js`·`ww/[id].js`
  (본체 `wappen/share-page.js`)가 **사람(브라우저 UA)에겐 와펜 셸을 그 URL 에서 바로 200 으로** 낸다(`appShellHTML`: `env.ASSETS.fetch('/wappen/')` + `<base href="/wappen/">` 주입
  + `injectOg`; `app.js boot()` 가 경로 `/wp|ww/<id>` 를 `/wappen/#/project|work/<id>` 로 `replaceState`). 리다이렉트·해시·쿼리가 전혀 없어 인앱 브라우저가 깎을 것이 없다.
  **크롤러**(`isCrawler`: kakaotalk-scrap·facebookexternalhit·curl 등, UA 없음 포함)에게만 OG 태그 HTML(즉시 이동 스크립트·meta refresh 포함). 자산 바인딩이 없거나 포털 HTML 이 오면 302 폴백.
  경위: `/wappen/?p=` → 루트 `?wp=`+인라인 리다이렉트 → `/wp/<id>` 302+해시 순으로 고쳤지만 계속 연결 안 됨(2026-10-06~07; 운영 응답은 매번 정상 — `share-diag` 실측).
  302 의 `#fragment` 를 인앱 브라우저가 버릴 가능성까지 없앤 형태가 현재 것. 예전 쿼리형(`/?wp=`·`/?ww=`, `/wappen/?p=`·`?w=`)은 `functions/_middleware.js` 가
  사람은 302 → `/wp|ww/<id>`, 크롤러는 OG 주입(`?news=` 우선)으로 계속 받고, 루트 `index.html` `<head>` 맨 앞 인라인 스크립트는 정적 폴백용으로 남겨 둔다. `og:url` 은 항상 경로형.
  운영 응답 확인은 `share-diag` 워크플로(Actions, 수동: curl·카톡 인앱·스크랩 UA 별 상태/Location/og:url).
  **원인 확정(2026-10-08 실측)**: 카톡 카드를 누르면 `gatherallaround.pages.dev` 루트(포털)가 열렸다 = 카카오가 공유 링크 도메인이 [플랫폼 → Web 사이트 도메인]
  등록값과 정확히(https·www 포함) 일치하지 않으면 **등록된 첫 번째 도메인 루트로 바꿔 연다**. 코드로는 못 막는다 — 카카오 디벨로퍼스에서
  `https://gatherallaround.com` 을 사이트 도메인에(가능하면 첫 번째로) 등록하면 끝 — **2026-10-08 등록 후 해결 확인**. 서버 쪽(/wp·/ww 셸·302·OG)은 `share-diag` 로 매번 정상이었다.
- **이름 중복 방지(2026-10-07)**: 프로젝트 제목은 전체에서, 작품 제목은 같은 프로젝트 안에서 유일 — 키는 `titleKey()`(앞뒤·연속 공백, 대소문자 무시).
  서버가 저장 전 `titleTaken()`(ilike 후보 → 정확 비교)로 검사해 **409 `dup_title`**, 비워 보낸 작품 기본 제목(프로젝트명)은 `uniqueTitle()` 이 "이름 (2)" 번호를 붙인다.
  클라는 프로젝트 생성 전 anon 사전 확인(`projectTitleTaken`, 공개 행만 보임), 작품 저장 프롬프트 기본값은 `suggestWorkTitle()` 로 비어 있는 번호 제안.
  선택 마이그레이션 `20261007_wappen_unique_titles.sql`(기존 중복 정리 후 `wappen_title_key()` 유일 인덱스) 적용 시 동시 요청까지 차단 — PostgREST 409 를 서버가 `dup_title` 로 변환.
- **관리자 와펜 일괄 관리**: 와펜 탭에 검색(이름·분류·태그)·분류 칩·행 체크박스(분류 전체 선택) → 하단 `.bulk-bar` [선택 삭제], 분류 머리줄 [분류 전체 삭제].
  서버 `admin_items_delete {item_ids≤500 | category}` — 작품 레이아웃이 참조하는 와펜은 숨김, 나머지 삭제(단건과 같은 규칙). 사용 여부는 `usedItemIds()` 가
  `or=(layout.cs.{"items":[{"id":…}]},…)` 로 30개씩 한 요청(단일 항목 JSON 엔 쉼표가 없어 or 파서에 안전) — 와펜 수만큼 count 를 돌리지 말 것(Workers 서브리퀘스트 한도).
- 반응 5종(love/cool/lol/wow/fire, 작품당 1인 1개) · 리믹스(`remix_of`) · 신고/숨김/차단 · 와펜 요청(관리자 승인 시 등록 와펜 연결). 댓글 없음.
  와펜 등록 폼(`itemFormModal`)은 PNG·JPG·WebP 를 받아 **클라이언트에서 PNG 로 변환**(투명 유지, MIME 대신 디코드 성공으로 판정 — iOS 는 type 이 비기도 함).
  요청 승인은 같은 폼을 `prefill.request` 모드로 열어 요청자의 참고 이미지를 기본 선택 → [승인하고 등록] 한 번으로 등록+`admin_request_resolve(approved)`.
- **기본 와펜 세트 = 자수 패치 30개(래스터, SEED_VERSION 3)**. 코드로 그린 벡터 84개는 2026-10-07 요청으로 목록·`wappen/seed/` 에서 제거(옵트인: `build.mjs` 를 돌리면 다시 렌더·포함).
  DB 에 남은 이전 세트 행은 관리자 카드 [이전 세트 N개 삭제] → `admin_seed_prune`(seed 경로지만 manifest 에 없는 행만 `removeItems()`: 작품에 쓰인 것은 숨김·나머지 삭제; `admin_seed_status.stale`).
  벡터 파이프라인(7 카테고리 — 과일 18개는 얼굴 없는 입체 표현: `vol()` 방사 그라데이션+클립 그늘+하이라이트, `ribbon()` 곡선 띠): `tools/wappen-seed/designs.mjs` 에서 코드로 그린 원본 SVG(CC0) → `build.mjs`(Playwright 렌더) + `finish.py`(여백 자르기·256색 팔레트) →
  `wappen/seed/*.png` + `manifest.js`(생성 파일, 서버·클라 공용 import). 관리자 와펜 탭 [기본 와펜 세트 불러오기] → `admin_seed_items`: `image_url` 이
  `https://gatherallaround.com/wappen/seed/<file>` 인 행만 삽입(스토리지 복사 없음, 이미 있으면 건너뜀). `_headers` 가 `/wappen/seed/*` 에 CORS `*`(캔버스 오염 방지).
  한글 글자 와펜은 저장소 꾸불림체 TTF 를 빌드 때 가짜 URL(`http://seed.local/`)로 서빙해 렌더. 새 와펜은 designs.mjs 에 `add()` 한 줄 → 빌드 → 커밋.
  **자수 질감 벡터(2026-10-08, 키 `e-…`)**: `emb(d, fill, {angle, border, bw, puff})` = 채움 + 실 결 패턴(`threads`) + 안쪽 그늘(볼륨) + 새틴 테두리(굵은 선 위 밝음/어두움 교대 점선),
  `embText()` 글자, `embWrap()` 그림자. 검토용 렌더는 `preview.mjs --only k1,k2 --out <dir> --sheet <png>`(+`sheet.py`) — wappen/seed·manifest 는 안 건드림.
  승인된 것만 세트에 넣으려면 build.mjs 가 아니라 선택 렌더 → finish.py 병합이 필요(아직 없음; 전체 build.mjs 는 벡터 84개를 전부 되살리니 쓰지 말 것).
  **래스터 세트**(2026-10-07, `kind:'raster'`, 키 `p-…`, SEED_VERSION 2): 운영자가 준 자수 패치 시트(`tools/wappen-seed/raster/*.png`, 격자 5×6)를 `raster.py` 가
  질감(국소 그라데이션) 마스크 → 닫힘·구멍 메움 → 연결 성분 → 행·열 묶음 배정(길쭉하면 잘록한 줄에서 분리) → 셀별 알파로 잘라 원본 해상도 그대로 저장(numpy·PIL 만).
  시트가 투명 배경 RGBA(완전 투명 2% 이상 — 2026-10-19 낱개 라벨 때문에 20%→2%)면 질감 대신 **알파 채널을 마스크·컷아웃 알파로 그대로** 쓴다(처음 두 시트, 2026-10-07 두 번째 시트 6개 = 키 `p2-…`,
  2026-10-19 낱개 라벨 2개 = 키 `p5-…` 「CLUB FF」·「26/11/21(Sat) 5PM」 — 1×1 시트 한 장 = 한 칸, 원본이 327·468px 로 작아 유닛 테스트 래스터 최소를 90px 로 내림. 총 64개, SEED_VERSION 5).
  **체커보드가 그림으로 박힌 시트**(`"bg":"checker"`, 2026-10-12 WebP 두 장 = 키 `p3-…` 6개·`p4-…` 20개)는 질감 "평균" 대신 9×9 창 **에지 픽셀 비율**(density 0.45)로
  전경을 잡아 체커 눈금이 안 잡히고, 구멍은 작고(hole_max 2500px²) 배경 같지 않은 것만 메우며(도넛 구멍·음표 사이·캔과 반짝이 사이 체커 주머니는 비움), 가장자리 10px 띠의
  "배경 같은" 픽셀(무채색·주변 체커 두 단계 밝기 범위 = 그림자 포함, 반지름 80px 창 평균±표준편차로 추정)을 **바깥에서 이어진 것만** 벗긴 뒤 알파를 1px 깎는다.
  점선 궤적처럼 채움비 15% 미만 조각은 버리고 반짝이는 큰 조각의 1% 이상이면 유지(`min_area` 는 시트별, 20개 시트는 300). `Image.fromarray` 결과엔 floodfill 이 조용히 무시되므로 `.copy()` 후 쓸 것(2026-10-12 실수).
  메타는 `raster.json`(시트·rows/cols·threshold·항목 순서 = 읽기 순). `finish.py` 가 벡터 뒤에 합쳐 manifest 를 쓰고, `finish.py --reuse wappen/seed --no-vector` 는 벡터 없이 래스터만 다시 자른다.
  시트 한 장 추가 = raster.json 에 sheets 항목 + 이미지 커밋 → `--reuse` 실행 → 관리자 [불러오기]. 유닛 테스트는 래스터를 100~1024px·≤160KB 로 따로 검사.
  **app.js 를 고치면 `wappen/index.html` 의 `app.js?v=N` 을 반드시 올릴 것**(안 올리면 폰이 예전 코드를 씀 — 2026-10-06 두 번 누락).
- **크기 체계(2026-10-06 통일)**: 글자는 `--fs-h1 1.25 / h2 1.02 / body 0.92 / sm 0.84 / xs 0.76rem` 5단계만(예외: hero 제목·탭 라벨·메달·빈 상태 아이콘·서랍 라벨).
  버튼은 `gaa-btn` md 44px = 폼 제출 `-block`·로그인만 / `-sm` 38px = 페이지 안 모든 액션 줄·모달 액션·CTA / `-xs` 32px = 리스트 행·에디터 상단바.
  아이콘은 `icon(name)`(app.js, 16px 단색 SVG·currentColor)만 — 버튼 텍스트에 이모지 금지(감정표현 5종·빈 상태 장식·로고만 예외, UI 테스트가 검사).
  상세 페이지 주 동작은 `.action-row`(sm 버튼 균등 분할 + 끝에 `icon-only` ⋯) 한 줄, 부가 동작(수정·숨기기·삭제·링크 복사·신고)은 `moreSheet()` 하단 시트.
  페이지 제목은 `.page-head`, 섹션은 `.section-title`(h2 + `.more`), 세그먼트 `.seg`(36px, `<a>`/`<button>` 공통), 인라인 `font-size` 금지.
  카드·순위·목록 썸네일(`.card-thumb`·`.rank-thumb`·`.list-row .thumb`)은 **contain + 여백**(10px/3px), 상세 미리보기 `.detail-img` 도 여백 16px(모바일 12px) — 꽉 채워 자르지 않는다(2026-10-07 요청).
  뷰 안에서 `#app` 에 거는 위임 리스너는 `onAppClick()`(render 마다 AbortController 로 해제 — 직접 `app.addEventListener` 하면 다음 화면에서도 살아남아 중복 동작).
- **라이브 갱신**: 뷰가 `setLive(fn)` 으로 "조용히 다시 그리는 함수"를 등록(서명 `sigOf()` 비교로 바뀐 때만 DOM 교체, 로딩 깜빡임 없음), `render()` 가 해제.
  `initLive()` 가 탭 복귀(visibilitychange/pageshow/focus)·25초 폴링·Supabase Realtime(`wappen_works/projects/items` postgres_changes, 발행 등록은
  `20261007_wappen_realtime.sql` 선택 실행 — 없으면 폴링만)으로 `liveKick()`. 홈엔 「방금 올라온 작품」 스트립(최신 10). 작품 화면은 반응 집계를 라이브로 갱신(내가 누르는 중엔 건너뜀).
- **헤더 맨 왼쪽 「← 돌아가기」(`.wp-back`, 2026-10-13)** = 포털 루트 `/` 링크 — 본 사이트 섹션들의 `.portal-back-btn` 과 같은 역할(와펜은 별도 페이지라 `showPortal()` 을 못 부름).
  ≤640px 는 36px 화살표만(`aria-label`·`title` 로 설명), 데스크톱은 글자까지. 편집 중 저장 안 한 변경은 기존 `beforeunload` 가 막는다. UI 테스트가 링크·터치 영역·한 줄 배치를 검사.
- 모바일(≤640px)은 헤더 메뉴 대신 **하단 탭바**(`.wp-bottom-nav`, SVG 아이콘, 편집 화면에선 숨김). 설치형(PWA, 상태바 black-translucent)·노치 대응은
  `--wp-safe-top/--wp-safe-bottom`(env(safe-area-inset-*))을 헤더·에디터·탭바·시트가 공유. `label.dropzone` 은 반드시 `display:block`(inline 이면 점선 테두리가 깨짐).
  이미지 업로드 UI 가 추가되면 같은 `.dropzone` 클래스를 쓸 것.
- 테스트: `tests/wappen-api-unit.mjs`·`tests/middleware-unit.mjs`(node) · `tests/ui-wappen.js`(Playwright, 가짜 supabase/Kakao/API, `VIEWPORT=390x844 DARK=1 SHOT_DIR=` 옵션).
  운영 절차·한도·주의는 `docs/WAPPEN-RUNBOOK.md`. 마이그레이션 `supabase/migrations/20261006_wappen.sql` 은 **master 머지 전에** SQL Editor 에서 실행.
