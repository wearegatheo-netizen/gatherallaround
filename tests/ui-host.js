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

  // ── 2. 카카오 로그인 → host_me(미등록) → 등록 폼 → 등록
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, host: null, is_admin: false });   // host_me
  });
  await p.click('button:has-text("카카오로 시작하기")');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => ({
    me: window.__apiCalls[0],
    regForm: !!document.getElementById('hostName'),
    teamFields: !!document.getElementById('hostBio') && !!document.getElementById('hostSns'),
    noLegacy: !document.getElementById('hostPhone') && !document.getElementById('hostBank'),
    nickPrefill: document.getElementById('hostName')?.value,
  }));
  chk('로그인 → host_me 검증 호출 → 등록 폼', s.me && s.me.action === 'host_me' && s.me.kakao_token === 'tok-123' && s.regForm);
  chk('등록 폼: 팀 중심(소개·SNS) + 연락처·계좌 필드 없음', s.teamFields && s.noLegacy);
  chk('팀 이름에 카카오 닉네임 자동 적용', s.nickPrefill === '카카오닉', s.nickPrefill);

  await p.fill('#hostName', '밴드 스컬');
  await p.fill('#hostBio', '신촌 5인조 밴드');
  await p.fill('#hostSns', 'instagram.com/bandskull');
  await p.evaluate(() => {
    window.__apiQueue.push({ ok: true, host: { id: 'h1', kakao_id: '777', name: '밴드 스컬', bio: '신촌 5인조 밴드', sns: 'instagram.com/bandskull', bank_info: '토스뱅크 1002-1111-2222 김호스트' } }); // register_host
    window.__apiQueue.push({ ok: true, host: { id: 'h1', name: '밴드 스컬', bank_info: '토스뱅크 1002-1111-2222 김호스트' }, is_admin: false, events: [] }); // my_events
  });
  await p.click('button:has-text("등록하고 시작하기")');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => ({
    reg: window.__apiCalls[1],
    dash: document.getElementById('host-container').textContent,
  }));
  chk('호스트 등록(팀 소개·SNS payload) → 대시보드', s.reg.action === 'register_host' && s.reg.name === '밴드 스컬'
    && s.reg.bio === '신촌 5인조 밴드' && s.reg.sns === 'instagram.com/bandskull' && s.dash.includes('등록한 공연이 없습니다'));

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

  // 소개에 서식 입력 후 저장
  await p.evaluate(() => {
    document.getElementById('evDescRte').innerHTML = '<h2>라인업</h2><p>밴드A · 밴드B</p>';
    window.__apiQueue.push({ ok: true, event: { id: '11111111-1111-4111-8111-111111111111' } });  // create_event
    window.__apiQueue.push({ ok: true, host: { id: 'h1', name: '밴드 스컬', bank_info: '토스뱅크 1002-1111-2222 김호스트' }, is_admin: false, events: [
      { id: '11111111-1111-4111-8111-111111111111', title: '한여름 밤의 락', venue: '홍대 클럽 FF',
        starts_at: new Date('2026-12-24T19:30').toISOString(), capacity: 50, price: 15000, bank_info: '토스뱅크 1002-1111-2222 김호스트', max_per_booking: 4,
        status: 'published', stats: { taken: 5, pending: 3, confirmed: 2, checked_in: 0 } },
    ] }); // my_events (재렌더)
  });
  await p.click('#evSaveBtn');
  await p.waitForTimeout(250);
  s = await p.evaluate(() => {
    const call = window.__apiCalls.find(c => c.action === 'create_event');
    return { call, dash: document.getElementById('host-container').textContent };
  });
  const e3 = s.call && s.call.event;
  chk('공연 등록 payload(제목·ISO일시·정원·콤마 가격 파싱)', e3 && e3.title === '한여름 밤의 락'
    && e3.starts_at === new Date('2026-12-24T19:30').toISOString() && e3.capacity === 50 && e3.price === 15000,
    JSON.stringify(e3).slice(0, 120));
  chk('payload: 계좌 합성(은행 계좌 예금주)', e3 && e3.bank_info === '토스뱅크 1002-1111-2222 김호스트', e3 && e3.bank_info);
  chk('payload: 장소 좌표·주소', e3 && e3.venue === '홍대 클럽 FF' && e3.venue_lat === 37.5511 && e3.venue_lng === 126.9203 && e3.venue_address.includes('와우산로'));
  chk('payload: 소개가 서식(HTML)으로 저장', e3 && e3.description.includes('<h2>라인업</h2>') && e3.description.includes('밴드A'));
  chk('대시보드: 공연 카드 + 집계 표시', s.dash.includes('한여름 밤의 락') && s.dash.includes('예매 5/50석') && s.dash.includes('입금대기 3'));

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

  // ── 6. QR 체크인 딥링크 (로그인 상태) — 성공/미확인/중복
  await p.evaluate(() => { window.__apiQueue.push({ ok: true, ticket: { id: 't1', code: 'QQ7MNP', buyer_name: '홍관객', qty: 2, event_id: '11111111-1111-4111-8111-111111111111', event_title: '한여름 밤의 락', checked_in_at: 'now' } }); });
  await p.evaluate(() => _routeToPage('host/checkin/QQ7MNP'));
  await p.waitForTimeout(250);
  s = await p.evaluate(() => ({
    call: window.__apiCalls.filter(c => c.action === 'checkin').pop(),
    txt: document.getElementById('host-container').textContent,
  }));
  chk('QR 딥링크: checkin 호출 + 성공 패널(이름·매수)', s.call && s.call.code === 'QQ7MNP' && s.txt.includes('입장 확인') && s.txt.includes('홍관객 · 2매'));
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

  chk('pageerror 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  await br.close();
  process.exit(fail ? 1 : 0);
})();
