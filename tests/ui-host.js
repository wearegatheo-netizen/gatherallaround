// 호스트 센터 UI 스모크: 로그인→등록→공연 등록→대시보드→명단→체크인 딥링크 + 티켓 QR
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & node tests/ui-host.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const EV_ID = '11111111-1111-4111-8111-111111111111';
const TK_ID = '22222222-2222-4222-8222-222222222222';
const FUTURE = new Date(Date.now() + 7 * 86400e3).toISOString();

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await br.newPage({ viewport: { width: 420, height: 950 }, deviceScaleFactor: 2 });
  await p.route('**://**', async r => {
    const u = new URL(r.request().url());
    return u.hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);

  await p.evaluate(() => {
    document.getElementById('portalLoadingScreen')?.remove();
    document.getElementById('bgm-player')?.remove();
    applyTheme('light');
    supabaseClient = { from: () => ({}), channel: () => ({}), removeChannel: () => {} };
    // Kakao SDK 스텁 — 토큰 없음 → 로그인 → 토큰 발급
    window.__kakaoToken = null;
    window.Kakao = {
      isInitialized: () => true, init: () => {},
      Auth: {
        getAccessToken: () => window.__kakaoToken,
        login: ({ success }) => { window.__kakaoToken = 'tok-123'; success(); },
        logout: () => {},
      },
      API: { request: ({ success }) => success({ id: 777, kakao_account: { profile: { nickname: '카카오닉' } } }) },
      Share: { sendDefault: (o) => { window.__shared = o; } },
    };
    // 카카오 지도 SDK 스텁 (장소 검색용)
    window.kakao = { maps: {
      load: (cb) => cb(),
      services: {
        Status: { OK: 'OK' },
        Places: function () { this.keywordSearch = (q, cb) => cb([
          { place_name: '홍대 클럽 FF', road_address_name: '서울 마포구 와우산로 12', address_name: '', y: '37.5511', x: '126.9203' },
          { place_name: '게더 올 어라운드', road_address_name: '서울 서대문구 신촌로 1', address_name: '', y: '37.5559', x: '126.9368' },
        ], 'OK'); },
      },
      Map: function () {}, LatLng: function () {}, Marker: function () {},
    } };
    // /event-api 목
    window.__apiCalls = []; window.__apiQueue = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (String(url) === '/event-api') {
        window.__apiCalls.push(JSON.parse(opts.body));
        const resp = window.__apiQueue.shift() || { ok: false, error: 'no-mock', message: 'no mock: ' + JSON.parse(opts.body).action };
        return Promise.resolve(new Response(JSON.stringify(resp), { status: 200 }));
      }
      return realFetch(url, opts);
    };
  });

  // ── 1. 비로그인 진입 → 로그인 화면 (서버 호출 없음)
  await p.evaluate(() => showHostSection());
  await p.waitForTimeout(200);
  let s = await p.evaluate(() => ({
    shown: !document.getElementById('host-page').classList.contains('hidden'),
    login: document.getElementById('host-container').textContent.includes('카카오로 시작하기'),
    calls: window.__apiCalls.length, hash: location.hash,
  }));
  chk('비로그인: 로그인 화면 + API 미호출', s.shown && s.login && s.calls === 0 && s.hash === '#host');

  // ── 2. 카카오 로그인 → 팀 없음 → 팀 등록 강제 → 팀 생성
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, teams: [], is_admin: false });   // host_me
  });
  await p.click('button:has-text("카카오로 시작하기")');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => ({
    me: window.__apiCalls[0],
    regForm: !!document.getElementById('hostName'),
    teamFields: !!document.getElementById('hostBio') && !!document.getElementById('hostSns'),
    noLegacy: !document.getElementById('hostPhone') && !document.getElementById('hostBank'),
    nickPrefill: document.getElementById('hostName')?.value,
    forced: document.getElementById('host-container').textContent.includes('먼저 팀을 만들어야'),
  }));
  chk('로그인 → host_me → 팀 없으면 팀 등록 강제', s.me && s.me.action === 'host_me' && s.regForm && s.forced);
  chk('등록 폼: 팀 중심(소개·SNS) + 연락처·계좌 필드 없음', s.teamFields && s.noLegacy);
  chk('팀 이름에 카카오 닉네임 자동 적용', s.nickPrefill === '카카오닉', s.nickPrefill);

  await p.fill('#hostName', '밴드 스컬');
  await p.fill('#hostBio', '신촌 5인조 밴드');
  await p.fill('#hostSns', 'instagram.com/bandskull');
  await p.evaluate(() => {
    const TEAM = { id: 'h1', kakao_id: '777', name: '밴드 스컬', bio: '신촌 5인조 밴드', sns: 'instagram.com/bandskull', bank_info: '토스뱅크 1002-1111-2222 김호스트', my_role: 'owner' };
    window.__apiQueue.push({ ok: true, team: TEAM });                                  // create_team
    window.__apiQueue.push({ ok: true, teams: [TEAM], is_admin: false });               // host_me (재로드)
    window.__apiQueue.push({ ok: true, is_admin: false, events: [] });                  // my_events
  });
  await p.click('button:has-text("팀 만들고 시작하기")');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({
    reg: window.__apiCalls[1],
    myev: window.__apiCalls.find(c => c.action === 'my_events'),
    dash: document.getElementById('host-container').textContent,
    sel: !!document.querySelector('#host-container select'),
    tabs: [...document.querySelectorAll('#host-container .community-tab')].map(b => b.textContent.trim()).join(','),
  }));
  chk('팀 생성(create_team payload) → 대시보드', s.reg.action === 'create_team' && s.reg.name === '밴드 스컬'
    && s.reg.bio === '신촌 5인조 밴드' && s.reg.sns === 'instagram.com/bandskull' && s.dash.includes('등록한 공연이 없습니다'));
  chk('대시보드: my_events 팀 스코프 + 목록형 select + 공연/팀 관리 탭', s.myev.host_id === 'h1'
    && s.sel && s.dash.includes('밴드 스컬') && s.dash.includes('+ 새 공연 등록') && s.tabs === '공연 관리,팀 관리', s.tabs);

  // ── 3. 새 공연 등록 폼 → 장소 검색·콤마 가격·분리 계좌·서식 소개 → payload 검증
  await p.click('button:has-text("+ 새 공연 등록")');
  await p.waitForTimeout(150);
  await p.fill('#evTitle', '한여름 밤의 락');
  await p.fill('#evStartsAt', '2026-12-24T19:30');
  await p.fill('#evCapacity', '50');
  await p.check('input[name="evPriceType"][value="paid"]');
  await p.fill('#evPrice', '15000');
  s = await p.evaluate(() => ({
    priceFmt: document.getElementById('evPrice').value,
    bankSel: document.getElementById('evBankSel').value,
    bankAcct: document.getElementById('evBankAcct').value,
    bankHolder: document.getElementById('evBankHolder').value,
    rte: !!document.getElementById('evDescRte') && document.getElementById('evDescRte').isContentEditable,
  }));
  chk('가격 입력: 콤마 자동 표기', s.priceFmt === '15,000', s.priceFmt);
  chk('계좌 분리 프리필(호스트 기본값 파싱)', s.bankSel === '토스뱅크' && s.bankAcct === '1002-1111-2222' && s.bankHolder === '김호스트',
    `${s.bankSel}|${s.bankAcct}|${s.bankHolder}`);
  chk('공연 소개: 서식 에디터(contenteditable)', s.rte);

  // 장소 검색 → 선택
  await p.fill('#evVenue', '홍대 클럽');
  await p.click('button:has-text("🔍 검색")');
  await p.waitForTimeout(200);
  s = await p.evaluate(() => document.getElementById('evVenueResults').textContent);
  chk('장소 검색: 결과 목록 표시', s.includes('홍대 클럽 FF') && s.includes('와우산로'));
  await p.click('#evVenueResults div >> nth=0');
  s = await p.evaluate(() => ({
    v: document.getElementById('evVenue').value,
    addr: document.getElementById('evVenueAddr').textContent,
  }));
  chk('장소 선택: 입력값·주소 반영', s.v === '홍대 클럽 FF' && s.addr.includes('와우산로'));

  // 소개 서식 + 예매자 질문 입력 후 저장
  await p.fill('#evQuestion', '어떤 팀을 보러 오시나요?');
  await p.evaluate(() => {
    document.getElementById('evDescRte').innerHTML = '<h2>라인업</h2><p>밴드A · 밴드B</p>';
    window.__apiQueue.push({ ok: true, event: { id: '11111111-1111-4111-8111-111111111111' } });  // create_event
    window.__apiQueue.push({ ok: true, is_admin: false, events: [
      { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', venue: '홍대 클럽 FF',
        starts_at: new Date('2026-12-24T19:30').toISOString(), capacity: 50, price: 15000, bank_info: '토스뱅크 1002-1111-2222 김호스트', max_per_booking: 4,
        status: 'published', stats: { taken: 5, pending: 3, confirmed: 2, checked_in: 0 } },
    ] }); // my_events (재렌더)
  });
  await p.click('#evSaveBtn');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => {
    const call = window.__apiCalls.find(c => c.action === 'create_event');
    return { call, dash: document.getElementById('host-container').textContent,
      poster: /width:56px/.test(document.querySelector('#host-container .host-card').innerHTML) };
  });
  const e3 = s.call && s.call.event;
  chk('공연 등록 payload(제목·ISO일시·정원·콤마 가격 파싱)', e3 && e3.title === '한여름 밤의 락'
    && e3.starts_at === new Date('2026-12-24T19:30').toISOString() && e3.capacity === 50 && e3.price === 15000,
    JSON.stringify(e3).slice(0, 120));
  chk('payload: 팀 host_id 포함', s.call && s.call.host_id === 'h1');
  chk('payload: 계좌 합성(은행 계좌 예금주)', e3 && e3.bank_info === '토스뱅크 1002-1111-2222 김호스트', e3 && e3.bank_info);
  chk('payload: 장소 좌표·주소', e3 && e3.venue === '홍대 클럽 FF' && e3.venue_lat === 37.5511 && e3.venue_lng === 126.9203 && e3.venue_address.includes('와우산로'));
  chk('payload: 소개가 서식(HTML)으로 저장', e3 && e3.description.includes('<h2>라인업</h2>') && e3.description.includes('밴드A'));
  chk('payload: 예매자 질문 포함', e3 && e3.booking_question === '어떤 팀을 보러 오시나요?');
  chk('대시보드: 공연 카드 + 집계 + 포스터 썸네일(폴백)', s.dash.includes('한여름 밤의 락') && s.dash.includes('예매 5/50석') && s.dash.includes('입금대기 3') && s.poster);

  // ── 3b. 카드 버튼 순서·이름 + 공연 삭제
  s = await p.evaluate(() => [...document.querySelectorAll('#host-container .host-card button')].map(b => b.textContent.trim()).join(','));
  chk('카드 버튼: 바로가기·마감(오픈)·예매자 관리·수정·삭제 순', s === '바로가기,마감,예매자 관리,수정,삭제', s);
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true });                                                    // delete_event (confirm 자동 수락)
    window.__apiQueue.push({ ok: true, is_admin: false, events: [
      { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', venue: '홍대 클럽 FF',
        starts_at: new Date('2026-12-24T19:30').toISOString(), capacity: 50, price: 15000, bank_info: '토스뱅크 1002-1111-2222 김호스트', max_per_booking: 4,
        status: 'published', stats: { taken: 5, pending: 3, confirmed: 2, checked_in: 0 } },
    ] }); // my_events 재렌더 (다음 테스트가 이 공연을 계속 사용)
  });
  await p.click('button:has-text("삭제")');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => window.__apiCalls.filter(c => c.action === 'delete_event').pop());
  chk('삭제 버튼: delete_event 호출(공연 id)', s && s.event_id === '11111111-1111-4111-8111-111111111111');

  // ── 4. 예매자 명단: 상태별 버튼 + 입금 확인
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, event: { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', capacity: 50 }, tickets: [
      { id: 't-pend', event_id: '11111111-1111-4111-8111-111111111111', code: 'AAA222', buyer_name: '김대기', buyer_phone: '01011112222', qty: 2, status: 'pending_payment', checked_in_at: null },
      { id: 't-conf', event_id: '11111111-1111-4111-8111-111111111111', code: 'BBB333', buyer_name: '이확정', buyer_phone: '01033334444', qty: 1, status: 'confirmed', checked_in_at: null },
      { id: 't-in', event_id: '11111111-1111-4111-8111-111111111111', code: 'CCC444', buyer_name: '박입장', buyer_phone: '01055556666', qty: 1, status: 'confirmed', checked_in_at: new Date().toISOString() },
      { id: 't-cxl', event_id: '11111111-1111-4111-8111-111111111111', code: 'DDD555', buyer_name: '최취소', buyer_phone: '01077778888', qty: 1, status: 'cancelled', checked_in_at: null },
    ] });
  });
  await p.click('button:has-text("예매자 관리")');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => {
    const txt = document.getElementById('host-container').textContent;
    const btnsOf = (name) => { const card = [...document.querySelectorAll('#host-container .host-card')].find(el => el.textContent.includes(name));
      return [...card.querySelectorAll('button')].map(b => b.textContent.trim()); };
    return { hash: location.hash, sum: txt.includes('예매 4/50석') && txt.includes('입금대기 2') && txt.includes('입장 1'),
      pend: btnsOf('김대기'), conf: btnsOf('이확정'), inn: btnsOf('박입장'), cxl: btnsOf('최취소') };
  });
  chk('명단: 해시 + 집계(취소 제외 4석)', s.hash === '#host/event/' + EV_ID && s.sum);
  chk('명단: 상태별 버튼 구성', JSON.stringify(s.pend) === JSON.stringify(['입금 확인', '취소'])
    && JSON.stringify(s.conf) === JSON.stringify(['체크인', '확정 취소', '취소'])
    && JSON.stringify(s.inn) === JSON.stringify(['입장 취소']) && s.cxl.length === 0,
    `${s.pend}|${s.conf}|${s.inn}|${s.cxl}`);

  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, ticket: { id: 't-pend', status: 'confirmed' } });  // confirm_payment
    window.__apiQueue.push({ ok: true, event: { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', capacity: 50 }, tickets: [
      { id: 't-pend', event_id: '11111111-1111-4111-8111-111111111111', code: 'AAA222', buyer_name: '김대기', buyer_phone: '01011112222', qty: 2, status: 'confirmed', checked_in_at: null },
    ] }); // attendees 재조회
  });
  await p.click('button:has-text("입금 확인")');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => ({
    confirmCall: window.__apiCalls.find(c => c.action === 'confirm_payment'),
    refetched: window.__apiCalls.filter(c => c.action === 'attendees').length === 2,
    chip: document.getElementById('host-container').textContent.includes('확정'),
  }));
  chk('입금 확인: confirm_payment + 재조회 렌더', s.confirmCall && s.confirmCall.ticket_id === 't-pend' && s.refetched && s.chip);

  // ── 5. 검색 필터
  await p.evaluate(() => {
    _hostState.attendees = [
      { id: 'a', code: 'AAA222', buyer_name: '김대기', buyer_phone: '01011112222', qty: 1, status: 'confirmed', checked_in_at: null },
      { id: 'b', code: 'ZZZ999', buyer_name: '박다른', buyer_phone: '01099998888', qty: 1, status: 'confirmed', checked_in_at: null },
    ];
    _hostState.attQuery = 'ZZZ';
    _renderAttendeeList();
  });
  s = await p.evaluate(() => document.querySelectorAll('#host-container .host-card').length);
  chk('명단 검색: 예매번호 필터', s === 1);

  // ── 5b. 매수>1 예매: 티켓(좌석)별 입장 토글 — QR 1장 = 1명
  await p.evaluate(() => {
    _hostState.attEvent = { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', capacity: 50, host_name: '밴드 스컬' };
    _hostState.attCoTeams = []; _hostState.attIsHostTeam = true; _hostState.attQuery = '';
    _hostState.curEventId = '11111111-1111-4111-8111-111111111111';
    _hostState.attendees = [
      { id: 't-multi', code: 'AB3XKP', buyer_name: '멀티예매', buyer_phone: '01011113333', qty: 2, status: 'confirmed', checked_in_at: 'x',
        seats: [{ code: 'AB3XKP', seat_no: 1, checked_in_at: 'x' }, { code: 'ZZ9PQR', seat_no: 2, checked_in_at: null }] },
    ];
    _renderAttendeeList();
  });
  s = await p.evaluate(() => ({
    txt: document.getElementById('host-container').textContent,
    xBtns: document.querySelectorAll('#host-container button[title="이 티켓만 취소"]').length,
  }));
  chk('명단: 부분 입장 칩(입장 1/2) + 티켓별 토글 + 미입장 좌석 부분취소 ✕', s.txt.includes('입장 1/2')
    && s.txt.includes('티켓별') && s.xBtns === 1, `✕ ${s.xBtns}개`);
  s = s.txt;
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, ticket: { buyer_name: '멀티예매', qty: 2, seat_no: 2, seats_checked: 2, seats_total: 2 } }); // checkin(좌석2)
    window.__apiQueue.push({ ok: true, event: { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', capacity: 50 }, tickets: [], co_teams: [], is_host_team: true }); // 재조회
  });
  await p.click('button[title="체크인"]');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => window.__apiCalls.filter(c => c.action === 'checkin').pop());
  chk('좌석 토글: 미입장 좌석 클릭 → checkin(그 좌석 코드)', s && s.code === 'ZZ9PQR', s && s.code);
  await p.evaluate(() => {
    _hostState.attendees = [
      { id: 't-multi', code: 'AB3XKP', buyer_name: '멀티예매', buyer_phone: '01011113333', qty: 2, status: 'confirmed', checked_in_at: 'x',
        seats: [{ code: 'AB3XKP', seat_no: 1, checked_in_at: 'x' }, { code: 'ZZ9PQR', seat_no: 2, checked_in_at: null }] },
    ];
    _renderAttendeeList();
    window.__apiQueue.push({ ok: true }); // uncheckin (confirm은 dialog 자동 수락)
    window.__apiQueue.push({ ok: true, event: { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', capacity: 50 }, tickets: [], co_teams: [], is_host_team: true }); // 재조회
  });
  await p.click('button[title="입장 취소"]');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => window.__apiCalls.filter(c => c.action === 'uncheckin').pop());
  chk('좌석 토글: 입장 좌석(✓) 클릭 → uncheckin(그 좌석 코드)', s && s.code === 'AB3XKP', s && s.code);
  await p.evaluate(() => {
    _hostState.attendees = [
      { id: 't-multi', code: 'AB3XKP', buyer_name: '멀티예매', buyer_phone: '01011113333', qty: 2, status: 'confirmed', checked_in_at: 'x',
        seats: [{ code: 'AB3XKP', seat_no: 1, checked_in_at: 'x' }, { code: 'ZZ9PQR', seat_no: 2, checked_in_at: null }] },
    ];
    _renderAttendeeList();
    window.__apiQueue.push({ ok: true, whole: false, ticket: { id: 't-multi', qty: 1 } }); // host_cancel_seat (confirm 자동 수락)
    window.__apiQueue.push({ ok: true, event: { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', capacity: 50 }, tickets: [], co_teams: [], is_host_team: true }); // 재조회
  });
  await p.click('button[title="이 티켓만 취소"]');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => window.__apiCalls.filter(c => c.action === 'host_cancel_seat').pop());
  chk('좌석 부분취소: ✕ 클릭 → host_cancel_seat(미입장 좌석 코드) — 1명 입장 후에도', s && s.code === 'ZZ9PQR', s && s.code);

  // ── 6. QR 체크인 딥링크 (로그인 상태) — 성공(좌석 단위)/미확인/중복
  await p.evaluate(() => { window.__apiQueue.push({ ok: true, ticket: { id: 't1', code: 'QQ7MNP', buyer_name: '홍관객', qty: 2,
    seat_no: 1, seats_checked: 1, seats_total: 2, event_id: '11111111-1111-4111-8111-111111111111', event_title: '한여름 밤의 락', checked_in_at: 'now' } }); });
  await p.evaluate(() => _routeToPage('host/checkin/QQ7MNP'));
  await p.waitForTimeout(250);
  s = await p.evaluate(() => ({
    call: window.__apiCalls.filter(c => c.action === 'checkin').pop(),
    txt: document.getElementById('host-container').textContent,
  }));
  chk('QR 딥링크: checkin 호출 + 좌석 단위 성공 패널(N번 티켓·입장 현황)', s.call && s.call.code === 'QQ7MNP'
    && s.txt.includes('입장 확인') && s.txt.includes('홍관객 · 1번 티켓') && s.txt.includes('이 예매 입장 1/2'), s.txt.slice(0, 80));
  chk('성공 패널: 명단/대시보드 버튼', s.txt.includes('예매자 명단') && s.txt.includes('대시보드'));

  await p.evaluate(() => { window.__apiQueue.push({ ok: false, error: 'not_confirmed', message: '입금 확인이 안 된 티켓입니다.', ticket: { id: 't2', code: 'RR8PQS', buyer_name: '미입금', qty: 1, event_id: '11111111-1111-4111-8111-111111111111', event_title: 'x' } }); });
  await p.evaluate(() => hostDoCheckin('RR8PQS'));
  await p.waitForTimeout(200);
  s = await p.evaluate(() => document.getElementById('host-container').textContent);
  chk('미확인 티켓: 경고 패널 + [입금 확인 후 바로 체크인]', s.includes('입금 미확인 티켓') && s.includes('입금 확인 후 바로 체크인'));

  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, ticket: { id: 't2', status: 'confirmed' } });   // confirm_payment
    window.__apiQueue.push({ ok: true, ticket: { id: 't2', code: 'RR8PQS', buyer_name: '미입금', qty: 1, event_id: '11111111-1111-4111-8111-111111111111', event_title: 'x', checked_in_at: 'now' } }); // checkin 재시도
  });
  await p.click('button:has-text("입금 확인 후 바로 체크인")');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => ({
    seq: window.__apiCalls.slice(-2).map(c => c.action).join(','),
    ok: document.getElementById('host-container').textContent.includes('입장 확인'),
  }));
  chk('연속 처리: confirm_payment→checkin → 성공 패널', s.seq === 'confirm_payment,checkin' && s.ok, s.seq);

  // ── 7. 비로그인 QR 딥링크 → 로그인 유도 + 로그인 후 자동 체크인
  await p.evaluate(() => {
    window.__kakaoToken = null; _hostState.token = null;
    _routeToPage('host/checkin/TT2WXY');
  });
  await p.waitForTimeout(200);
  s = await p.evaluate(() => document.getElementById('host-container').textContent);
  chk('비로그인 딥링크: 체크인용 로그인 안내', s.includes('체크인을 하려면 호스트 로그인이 필요합니다'));
  await p.evaluate(() => {
    // 보류 체크인은 host_me를 건너뛰고 곧장 checkin (문 앞 왕복 절약)
    window.__apiQueue.push({ ok: true, ticket: { id: 't3', code: 'TT2WXY', buyer_name: '늦은관객', qty: 1, event_id: '11111111-1111-4111-8111-111111111111', event_title: 'x', checked_in_at: 'now' } }); // checkin
  });
  await p.click('button:has-text("카카오로 시작하기")');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({
    last: window.__apiCalls.slice(-1)[0],
    ok: document.getElementById('host-container').textContent.includes('늦은관객'),
  }));
  chk('로그인 후 보류 체크인 자동 이어감', s.last.action === 'checkin' && s.last.code === 'TT2WXY' && s.ok);

  // ── 7b. 팀 관리 탭: 멤버 목록 + 초대 코드 생성
  await p.evaluate(() => {
    window.__kakaoToken = 'tok-123'; _hostState.token = 'tok-123';
    _hostState.teams = [{ id: 'h1', name: '밴드 스컬', bio: '소개', my_role: 'owner' }];
    _hostState.curTeamId = 'h1'; _hostState.isAdmin = false;
    window.__apiQueue.push({ ok: true, members: [
      { kakao_id: '777', name: '카카오닉', role: 'owner' },
      { kakao_id: '888', name: '기타리스트', role: 'member' },
    ], my_role: 'owner', my_kakao_id: '777' });
    renderTeamManage('h1');
  });
  await p.waitForTimeout(200);
  s = await p.evaluate(() => ({
    txt: document.getElementById('host-container').textContent,
    activeTab: document.querySelector('#host-container .community-tab.active')?.textContent.trim(),
  }));
  chk('팀 관리 탭: 멤버 목록 + 역할 배지 + 초대 코드 입력 진입', s.activeTab === '팀 관리'
    && s.txt.includes('카카오닉') && s.txt.includes('팀 소유자') && s.txt.includes('기타리스트')
    && s.txt.includes('공동호스트') && s.txt.includes('내보내기') && s.txt.includes('초대 코드 입력'), s.activeTab);
  s = s.txt;
  await p.evaluate(() => { window.__shared = null;
    window.__apiQueue.push({ ok: true, token: 'HJ3KMP', expires_at: new Date(Date.now() + 7 * 86400e3).toISOString() }); });
  await p.click('button:has-text("공동호스트 초대 코드 만들기")');
  await p.waitForTimeout(200);
  s = await p.evaluate(() => ({ box: document.getElementById('inviteLinkBox').textContent,
    call: window.__apiCalls.filter(c => c.action === 'create_invite').pop(), shared: window.__shared }));
  chk('초대: create_invite → 6자리 코드 박스(즉시 공유 없음)', s.call && s.call.host_id === 'h1'
    && s.box.includes('HJ3KMP') && s.box.includes('초대 코드 입력') && !s.shared, s.box.slice(0, 40));
  await p.click('#inviteLinkBox-share');
  await p.waitForTimeout(150);
  s = await p.evaluate(() => window.__shared);
  chk('초대: [카카오톡 공유] → ?hostjoin= 코드 링크(해시 잘림 회피)', s && s.link.webUrl.includes('?hostjoin=HJ3KMP')
    && String(s.text).includes('HJ3KMP'), s && s.link.webUrl);

  // ── 7c. 초대 수락 딥링크 → 새 팀 합류 → 팀 관리 탭 랜딩
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, team: { id: 'h2', name: '어쿠스틱 팀' } });      // accept_invite
    window.__apiQueue.push({ ok: true, teams: [
      { id: 'h1', name: '밴드 스컬', my_role: 'owner' },
      { id: 'h2', name: '어쿠스틱 팀', my_role: 'member' }], is_admin: false });         // host_me
    window.__apiQueue.push({ ok: true, members: [
      { kakao_id: '999', name: '팀장', role: 'owner' },
      { kakao_id: '777', name: '카카오닉', role: 'member' }], my_role: 'member', my_kakao_id: '777' }); // list_members (팀 탭)
    _routeToPage('host/join/CDEFGH');
  });
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({
    acc: window.__apiCalls.filter(c => c.action === 'accept_invite').pop(),
    mem: window.__apiCalls.filter(c => c.action === 'list_members').pop(),
    dash: document.getElementById('host-container').textContent,
    selVal: (document.querySelector('#host-container select') || {}).value,
  }));
  chk('초대 수락: accept_invite → 팀 탭 랜딩(합류 팀 선택 + 멤버 표시)', s.acc && s.acc.token === 'CDEFGH'
    && s.mem.host_id === 'h2' && s.selVal === 'h2' && s.dash.includes('어쿠스틱 팀') && s.dash.includes('밴드 스컬')
    && s.dash.includes('팀장') && s.dash.includes('공동호스트'), s.selVal);

  // ── 7c2. 공연 관리팀(연합) — 명단 화면 관리팀 행 + 팀 초대 공유
  await p.evaluate(() => {
    _hostState.attEvent = { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', capacity: 50, host_name: '밴드 스컬' };
    _hostState.attendees = [];
    _hostState.attCoTeams = [{ id: 'h9', name: '재즈 콜렉티브', logo_url: null }];
    _hostState.attIsHostTeam = true;
    _hostState.curEventId = '11111111-1111-4111-8111-111111111111';
    _renderAttendeeList();
  });
  s = await p.evaluate(() => document.getElementById('host-container').textContent);
  chk('명단: 관리팀 행(주최+공동팀 ✕)과 [+ 팀 초대]', s.includes('주최 · 밴드 스컬') && s.includes('재즈 콜렉티브') && s.includes('✕') && s.includes('+ 팀 초대'));
  await p.evaluate(() => { window.__shared = null;
    window.__apiQueue.push({ ok: true, token: 'AA23BB', expires_at: new Date(Date.now() + 7 * 86400e3).toISOString(), event: { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락' } }); });
  await p.click('button:has-text("+ 팀 초대")');
  await p.waitForTimeout(200);
  s = await p.evaluate(() => ({ box: document.getElementById('coInviteBox').textContent,
    call: window.__apiCalls.filter(c => c.action === 'create_event_invite').pop(), shared: window.__shared }));
  chk('팀 초대: create_event_invite → 코드 박스(즉시 공유 없음)', s.call && s.call.event_id === '11111111-1111-4111-8111-111111111111'
    && s.box.includes('AA23BB') && !s.shared, s.box.slice(0, 40));
  await p.click('#coInviteBox-share');
  await p.waitForTimeout(150);
  s = await p.evaluate(() => window.__shared);
  chk('팀 초대: [카카오톡 공유] → ?eventjoin= 코드 링크', s && s.link.webUrl.includes('?eventjoin=AA23BB'), s && s.link.webUrl);

  // ── 7c3. 공연 관리팀 초대 수락 — 팀 선택 → 팀 단위 합류
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, teams: [{ id: 'h1', name: '밴드 스컬', my_role: 'owner' }], is_admin: false }); // host_me
    window.__apiQueue.push({ ok: true, event: { id: 'e9', title: '연합공연', starts_at: new Date(Date.now() + 5 * 86400e3).toISOString(), host_name: '주최팀B' } }); // event_invite_info
    _routeToPage('host/eventjoin/BB7XYZ');
  });
  await p.waitForTimeout(350);
  s = await p.evaluate(() => ({
    txt: document.getElementById('host-container').textContent,
    sel: !!document.getElementById('ejTeamSel'),
  }));
  chk('팀 초대 수락 화면: 공연 정보 + 팀 선택 셀렉트', s.sel && s.txt.includes('연합공연') && s.txt.includes('주최팀B') && s.txt.includes('어느 팀으로'), s.txt.slice(0, 80));
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, event: { id: 'e9', title: '연합공연' } });   // accept_event_invite
    window.__apiQueue.push({ ok: true, teams: [{ id: 'h1', name: '밴드 스컬', my_role: 'owner' }], is_admin: false }); // host_me
    window.__apiQueue.push({ ok: true, is_admin: false, events: [] });               // my_events
  });
  await p.click('button:has-text("이 팀으로 공연 관리에 참여하기")');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({ acc: window.__apiCalls.filter(c => c.action === 'accept_event_invite').pop() }));
  chk('팀 초대 수락: accept_event_invite(token+host_id)', s.acc && s.acc.token === 'BB7XYZ' && s.acc.host_id === 'h1');

  // ── 7c4. 초대 코드 직접 입력 — 형식 검증 → lookup_invite → 팀 합류
  await p.evaluate(() => renderInviteCodeEntry());
  await p.fill('#inviteCodeInput', 'AB1');
  await p.click('button:has-text("확인")');
  await p.waitForTimeout(100);
  s = await p.evaluate(() => ({
    err: document.getElementById('inviteCodeResult').textContent,
    noCall: !window.__apiCalls.some(c => c.action === 'lookup_invite'),
  }));
  chk('코드 입력: 형식 오류 인라인 표시 + API 미호출', s.err.includes('6자리') && s.noCall, s.err);
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, type: 'team', team: { id: 'h3', name: '코드팀' } });   // lookup_invite
    window.__apiQueue.push({ ok: true, team: { id: 'h3', name: '코드팀' } });                  // accept_invite (confirm은 dialog 자동 수락)
    window.__apiQueue.push({ ok: true, teams: [
      { id: 'h1', name: '밴드 스컬', my_role: 'owner' },
      { id: 'h3', name: '코드팀', my_role: 'member' }], is_admin: false });                     // host_me
    window.__apiQueue.push({ ok: true, members: [
      { kakao_id: '777', name: '카카오닉', role: 'member' }], my_role: 'member', my_kakao_id: '777' }); // list_members (팀 탭 랜딩)
  });
  await p.fill('#inviteCodeInput', 'gh3kmp');   // 소문자 입력 → 대문자 정규화 확인
  await p.click('button:has-text("확인")');
  await p.waitForTimeout(350);
  s = await p.evaluate(() => ({
    lk: window.__apiCalls.filter(c => c.action === 'lookup_invite').pop(),
    acc: window.__apiCalls.filter(c => c.action === 'accept_invite').pop(),
    dash: document.getElementById('host-container').textContent,
  }));
  chk('코드 입력: lookup_invite(대문자 정규화) → 팀 합류 → 팀 탭', s.lk && s.lk.token === 'GH3KMP'
    && s.acc && s.acc.token === 'GH3KMP' && s.dash.includes('코드팀'));

  // ── 7d. 예매자 명단 CSV 다운로드
  s = await p.evaluate(async () => {
    HTMLAnchorElement.prototype.click = function () { window.__dl = { href: this.href, name: this.download }; };
    window.__csvBlob = null;
    URL.createObjectURL = (b) => { window.__csvBlob = b; return 'blob:mock'; };
    _hostState.attEvent = { title: '한여름 밤의 락', capacity: 50 };
    _hostState.attendees = [
      { buyer_name: '홍길동', buyer_phone: '01012345678', qty: 2, code: 'AB3XKP', status: 'confirmed', checked_in_at: null, created_at: new Date().toISOString() },
      { buyer_name: '김"인용', buyer_phone: '01099998888', qty: 1, code: 'CC7MNP', status: 'pending_payment', checked_in_at: null, created_at: new Date().toISOString() },
    ];
    downloadAttendeesCSV();
    const buf = window.__csvBlob ? new Uint8Array(await window.__csvBlob.arrayBuffer()) : new Uint8Array(0);
    const text = window.__csvBlob ? await window.__csvBlob.text() : '';
    // Blob.text()는 디코딩하며 BOM을 제거하므로, BOM은 바이트(EF BB BF)로 확인
    return { name: window.__dl && window.__dl.name, text, bom: buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF };
  });
  chk('CSV: BOM+헤더+행+따옴표 이스케이프+상태 한글', s.name && s.name.startsWith('예매자_한여름 밤의 락')
    && s.bom && s.text.includes('이름') && s.text.includes('홍길동')
    && s.text.includes('김""인용') && s.text.includes('입금대기'), s.name);

  // ── 7e. QR 이미지 저장 (PNG dataURL)
  s = await p.evaluate(() => {
    window.__dl = null;
    downloadTicketQR('AB3XKP');
    return window.__dl;
  });
  chk('QR 저장: PNG dataURL + 파일명', s && s.href.startsWith('data:image/png') && s.name === 'ticket-AB3XKP.png');

  // ── 8. 티켓 화면 QR 렌더 (vendor 라이브러리 실로드)
  s = await p.evaluate(() => {
    _showsState.ticket = { code: 'AB3XKP', buyer_name: '홍길동', buyer_phone: '01012345678', qty: 1, status: 'confirmed', checked_in_at: null };
    _showsState.tEvent = { title: '공연', host_name: 'x', venue: '게더', starts_at: new Date(Date.now() + 86400e3).toISOString(), price: 0 };
    showShowsSection(); // 화면 전환용
    document.getElementById('shows-container').innerHTML = '<div id="ticketQrSlot"></div>';
    renderTicketQR(document.getElementById('ticketQrSlot'), 'AB3XKP');
    const svg = document.querySelector('#ticketQrSlot .qr-frame svg');
    return { hasSvg: !!svg, lib: typeof qrcode !== 'undefined' };
  });
  chk('QR: vendor 라이브러리 로드 + SVG 생성', s.lib && s.hasSvg);

  // ── 9. ?hostjoin= 쿼리 진입(카카오톡 공유 경유) — 포털이 아니라 호스트 존으로
  const p2 = await br.newPage({ viewport: { width: 420, height: 900 } });
  await p2.route('**://**', async r => {
    const u = new URL(r.request().url());
    return u.hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await p2.goto('http://127.0.0.1:8765/index.html?hostjoin=efghjk', { waitUntil: 'domcontentloaded' }); // 소문자 → 대문자 정규화
  await p2.waitForTimeout(1800);
  s = await p2.evaluate(() => ({
    hostShown: !document.getElementById('host-page').classList.contains('hidden'),
    portalHidden: document.getElementById('portal-page').classList.contains('hidden'),
    notice: document.getElementById('host-container').textContent.includes('초대를 받았습니다'),
    cleanUrl: !location.search,
    loadingGone: !document.getElementById('portalLoadingScreen'),
  }));
  chk('?hostjoin 진입: 포털 대신 호스트 존 + 초대 안내 + URL 정리 + 로딩 해제',
    s.hostShown && s.portalHidden && s.notice && s.cleanUrl && s.loadingGone, JSON.stringify(s));
  await p2.close();

  chk('pageerror 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  await br.close();
  process.exit(fail ? 1 : 0);
})();
