// 공연 예매 공개 존 UI 스모크 + 라우팅 회귀 테스트
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & node tests/ui-shows.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const EV1 = '11111111-1111-4111-8111-111111111111'; // 유료·잔여 3석
const EV2 = '22222222-2222-4222-8222-222222222222'; // 무료·여유
const EV3 = '33333333-3333-4333-8333-333333333333'; // 매진
const FUTURE = (d) => new Date(Date.now() + d * 86400e3).toISOString();
const PAST = new Date(Date.now() - 5 * 86400e3).toISOString();

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await br.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  await p.route('**://**', async r => {
    const u = new URL(r.request().url());
    return u.hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);

  await p.evaluate(({ EV1, EV2, EV3, F7, F14, PAST }) => {
    document.getElementById('portalLoadingScreen')?.remove();
    document.getElementById('bgm-player')?.remove();
    applyTheme('light');
    const TABLES = {
      event_host_profiles: [
        { id: 'h1', name: '밴드 스컬', bio: '신촌에서 활동하는 5인조 밴드', sns: 'instagram.com/bandskull' },
      ],
      events: [
        { id: EV1, host_id: 'h1', host_name: '밴드 스컬', title: '한여름 밤의 락', description: '신촌 최고의 밴드\n라인업 공개', poster_url: '', venue: '게더 올 어라운드', venue_address: '서울 서대문구 신촌로 1', venue_lat: 37.5559, venue_lng: 126.9368, starts_at: F7, capacity: 40, price: 15000, bank_info: '토스뱅크 1002-1111-2222 김호스트', max_per_booking: 4, status: 'published' },
        { id: EV2, host_id: 'h1', host_name: '어쿠스틱 팀', title: '무료 어쿠스틱 나잇', description: '', poster_url: '', venue: '게더 올 어라운드', starts_at: F14, capacity: 30, price: 0, bank_info: null, max_per_booking: 2, status: 'published' },
        { id: EV3, host_id: 'h2', host_name: '재즈 콜렉티브', title: '재즈의 밤 (매진)', description: '', poster_url: '', venue: '게더', starts_at: F7, capacity: 20, price: 10000, bank_info: 'x', max_per_booking: 4, status: 'published' },
        { id: '44444444-4444-4444-8444-444444444444', host_id: 'h2', host_name: '지난팀', title: '지난 공연', description: '', poster_url: '', venue: '게더', starts_at: PAST, capacity: 20, price: 0, bank_info: null, max_per_booking: 4, status: 'published' },
      ],
      event_seats: [
        { event_id: EV1, capacity: 40, taken: 37 },
        { event_id: EV2, capacity: 30, taken: 4 },
        { event_id: EV3, capacity: 20, taken: 20 },
      ],
    };
    const mk = (t) => {
      let single = false, idFilter = null;
      const h = new Proxy(function () {}, {
        get(_, k) {
          if (k === 'then') return (res) => {
            let d = TABLES[t] || [];
            if (idFilter) d = d.filter(r => r.id === idFilter || r.event_id === idFilter);
            res({ data: single ? (d[0] ?? null) : d, error: null });
          };
          if (k === 'maybeSingle' || k === 'single') return () => { single = true; return h; };
          if (k === 'eq') return (col, val) => { idFilter = val; return h; };
          return () => h;
        },
        apply() { return h; },
      });
      return h;
    };
    supabaseClient = { from: t => mk(t), channel: () => ({ on: () => ({ subscribe: () => {} }) }), removeChannel: () => {} };
    // /event-api 목: 큐에 넣은 응답을 순서대로 반환
    window.__apiCalls = []; window.__apiQueue = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (String(url) === '/event-api') {
        window.__apiCalls.push(JSON.parse(opts.body));
        const resp = window.__apiQueue.shift() || { ok: false, error: 'no-mock', message: 'no mock' };
        return Promise.resolve(new Response(JSON.stringify(resp), { status: 200 }));
      }
      return realFetch(url, opts);
    };
  }, { EV1, EV2, EV3, F7: FUTURE(7), F14: FUTURE(14), PAST });

  // ── 1. 포털 버튼 → 목록
  await p.click('button.portal-btn:has-text("공연 예매")');
  await p.waitForTimeout(400);
  let s = await p.evaluate(() => ({
    pageShown: !document.getElementById('shows-page').classList.contains('hidden'),
    others: ['portal-page', 'performance-booking-page'].filter(id => !document.getElementById(id).classList.contains('hidden')),
    cards: document.querySelectorAll('#shows-container .show-card').length,
    text: document.getElementById('shows-container').textContent,
    hash: location.hash,
  }));
  chk('포털 → 공연 예매: 화면 전환 + 해시', s.pageShown && s.others.length === 0 && s.hash === '#shows');
  chk('목록: 다가오는 3 + 지난 1 카드', s.cards === 4, `${s.cards}개`);
  chk('목록: 잔여 3석/매진/무료 배지', s.text.includes('잔여 3석') && s.text.includes('매진') && s.text.includes('무료') && s.text.includes('₩15,000'));
  chk('목록: 지난 공연 접힘 + 호스트 링크', s.text.includes('지난 공연 1개 보기') && s.text.includes('호스트 센터'));

  // ── 1b. 목록 검색: 제목/팀/장소 부분일치 + 입력 포커스 유지(본문만 재렌더)
  await p.fill('#showSearch', '재즈');
  await p.waitForTimeout(150);
  s = await p.evaluate(() => ({
    cards: document.querySelectorAll('#showsListBody .show-card').length,
    text: document.getElementById('showsListBody').textContent,
    focus: document.activeElement && document.activeElement.id,
  }));
  chk('목록 검색: "재즈" → 1건(팀·제목 일치) + 포커스 유지', s.cards === 1 && s.text.includes('재즈의 밤') && s.focus === 'showSearch', `${s.cards}개·${s.focus}`);
  await p.fill('#showSearch', 'zzz없는공연');
  await p.waitForTimeout(150);
  s = await p.evaluate(() => ({
    cards: document.querySelectorAll('#showsListBody .show-card').length,
    empty: document.getElementById('showsListBody').textContent.includes('검색 결과가 없습니다'),
  }));
  chk('목록 검색: 결과 없음 안내', s.cards === 0 && s.empty);
  await p.fill('#showSearch', '');
  await p.waitForTimeout(150);
  s = await p.evaluate(() => document.querySelectorAll('#showsListBody .show-card').length);
  chk('목록 검색: 지우면 전체 복원(4카드)', s === 4, `${s}개`);

  // ── 2. 상세 진입 (pushState) + 뒤로가기 복귀
  const lenBefore = await p.evaluate(() => history.length);
  await p.click(`#shows-container .show-card >> nth=0`);
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({
    hash: location.hash, title: document.getElementById('shows-container').textContent.includes('한여름 밤의 락'),
    form: !!document.getElementById('showName'), bank: document.getElementById('shows-container').textContent.includes('계좌이체 예매'),
    desc: document.getElementById('shows-container').innerHTML.includes('신촌 최고의 밴드<br>라인업 공개'),
    descBox: !!document.querySelector('#shows-container .docs-card-content'),
    bio: document.getElementById('shows-container').textContent.includes('신촌에서 활동하는 5인조 밴드'),
    sns: document.querySelector('#shows-container a[href="https://instagram.com/bandskull"]')?.rel,
    mapDiv: !!document.getElementById('showMap'),
    mapLink: document.querySelector('#shows-container a[href^="https://map.kakao.com/link/map/"]')?.href || '',
    addr: document.getElementById('shows-container').textContent.includes('서울 서대문구 신촌로 1'),
  }));
  chk('상세: 해시 #shows/{id} + 폼 + 계좌 안내 + 소개 서식 렌더', s.hash === '#shows/' + EV1 && s.title && s.form && s.bank && s.desc && s.descBox);
  chk('상세: 팀 소개 + SNS 링크(https 보정·noopener)', s.bio && s.sns === 'noopener');
  chk('상세: 지도 영역 + 카카오맵 링크 + 주소', s.mapDiv && s.mapLink.includes('37.5559') && s.addr, s.mapLink.slice(0, 60));
  await p.goBack();
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({ hash: location.hash, list: document.querySelectorAll('#shows-container .show-card').length }));
  chk('뒤로가기: 목록 복귀(pushState 확인)', s.hash === '#shows' && s.list === 4, s.hash);

  // ── 3. 예매 폼 검증 → 성공(유료 → 입금 안내)
  await p.evaluate((EV1) => showShowsSection([EV1]), EV1);
  await p.waitForTimeout(200);
  await p.fill('#showName', '홍길동');
  await p.fill('#showPhone', '010-1234-5678');
  await p.selectOption('#showQty', '2');
  await p.click('#showBookBtn');
  s = await p.evaluate(() => ({ err: document.getElementById('showsBookResult').textContent, calls: window.__apiCalls.length }));
  chk('동의 없이 제출: 인라인 오류 + API 미호출', s.err.includes('개인정보') && s.calls === 0, s.err);
  await p.evaluate((EV1) => {
    window.__apiQueue.push({ ok: true,
      ticket: { id: 't1', event_id: EV1, code: 'AB3XKP', buyer_name: '홍길동', buyer_phone: '01012345678', qty: 2, status: 'pending_payment', checked_in_at: null },
      event: { id: EV1, title: '한여름 밤의 락', host_name: '밴드 스컬', venue: '게더 올 어라운드', starts_at: new Date(Date.now() + 7 * 86400e3).toISOString(), price: 15000, bank_info: '토스뱅크 1002-1111-2222 김호스트' } });
  }, EV1);
  await p.check('#showPrivacyAgree');
  await p.click('#showBookBtn');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({
    hash: location.hash,
    call: window.__apiCalls[0],
    text: document.getElementById('shows-container').textContent,
  }));
  chk('예매 성공: book 호출 payload', s.call && s.call.action === 'book' && s.call.event_id === EV1 && s.call.qty === 2 && s.call.phone === '010-1234-5678');
  chk('티켓 화면: 코드+입금 안내+금액(2매 30,000)', s.hash === '#shows/ticket/AB3XKP' && s.text.includes('AB3XKP') && s.text.includes('입금 안내') && s.text.includes('₩30,000') && s.text.includes('입금 확인 중'));
  chk('티켓 화면: 입금자명 안내', s.text.includes('예매자 이름(홍길동)'));

  // ── 4. 예매 취소
  await p.evaluate(() => { window.__apiQueue.push({ ok: true, ticket: { status: 'cancelled', cancelled_at: 'x', cancelled_by: 'buyer' } }); });
  await p.click('button:has-text("예매 취소")');
  await p.waitForTimeout(300);
  s = await p.evaluate(() => ({
    call: window.__apiCalls[1],
    chip: document.getElementById('shows-container').textContent.includes('취소됨'),
    noCancelBtn: ![...document.querySelectorAll('#shows-container button')].some(b => b.textContent.includes('예매 취소')),
  }));
  chk('취소: cancel 호출(code+phone) + 칩 갱신 + 버튼 제거', s.call && s.call.action === 'cancel' && s.call.code === 'AB3XKP' && s.call.phone === '01012345678' && s.chip && s.noCancelBtn);

  // ── 5. 티켓 새로고침 진입(메모리 없음) → 코드 프리필 조회 폼
  await p.evaluate(() => { _showsState.ticket = null; _routeToPage('shows/ticket/QQ7MNP'); });
  await p.waitForTimeout(200);
  s = await p.evaluate(() => ({
    find: !!document.getElementById('findCode'),
    prefill: document.getElementById('findCode')?.value,
  }));
  chk('티켓 딥링크(메모리 없음): 조회 폼 + 코드 프리필', s.find && s.prefill === 'QQ7MNP');

  // ── 6. _pageFromHash 파라미터 검증
  s = await p.evaluate((EV1) => {
    const t = (h) => { history.replaceState(null, '', h); return _pageFromHash(); };
    const out = {
      valid: t('#shows/' + EV1), badId: t('#shows/abc'), find: t('#shows/find'),
      ticket: t('#shows/ticket/ab3xkp'), badTicket: t('#shows/ticket/AB1'),
      checkin: t('#host/checkin/XYZ234'), badCheckin: t('#host/checkin/lol'),
      hostEv: t('#host/event/' + EV1), gatheo: t('#gatheo/board'), comm: t('#community/test'),
    };
    history.replaceState(null, '', '#shows');
    return out;
  }, EV1);
  chk('_pageFromHash: shows/{uuid} 통과', s.valid === 'shows/' + EV1);
  chk('_pageFromHash: 불량 id/코드 절단', s.badId === 'shows' && s.badTicket === 'shows' && s.badCheckin === 'host');
  chk('_pageFromHash: ticket 코드 대문자 정규화', s.ticket === 'shows/ticket/AB3XKP');
  chk('_pageFromHash: find/checkin/event 통과', s.find === 'shows/find' && s.checkin === 'host/checkin/XYZ234' && s.hostEv === 'host/event/' + EV1);
  chk('_pageFromHash: 기존 라우트 회귀 없음', s.gatheo === 'gatheo/board' && s.comm === 'community/test');

  // ── 7. _pushNav replace/push 정책
  s = await p.evaluate(() => {
    const out = {};
    history.replaceState({ page: 'gatheo' }, '', '#gatheo');
    const len1 = history.length;
    _pushNav('gatheo/reservation');            // 섹션→기본탭: replace
    out.gatheoReplace = history.length === len1 && history.state.page === 'gatheo/reservation';
    history.replaceState({ page: 'shows' }, '', '#shows');
    const len2 = history.length;
    _pushNav('shows/11111111-1111-4111-8111-111111111111'); // 목록→상세: push
    out.showsPush = history.length === (len2 < 50 ? len2 + 1 : len2) && history.state.page.startsWith('shows/');
    return out;
  });
  chk('_pushNav: gatheo 섹션→탭 replace 유지', s.gatheoReplace);
  chk('_pushNav: shows 목록→상세 push', s.showsPush);

  // ── 8. 기존 공개 섹션 회귀 (perf) + 호스트 자리표시
  s = await p.evaluate(() => {
    _routeToPage('perf');
    const perfOk = !document.getElementById('performance-booking-page').classList.contains('hidden')
      && document.getElementById('shows-page').classList.contains('hidden');
    _routeToPage('host');
    const hostOk = !document.getElementById('host-page').classList.contains('hidden')
      && document.getElementById('host-container').textContent.includes('카카오로 시작하기');
    return { perfOk, hostOk };
  });
  chk('회귀: #perf 정상 + 화면 누수 없음', s.perfOk);
  chk('호스트 센터: 비로그인 → 로그인 화면', s.hostOk);

  // ── 9. 무료 공연 상세: 계좌 안내 없음 + 매수 상한(max_per_booking=2)
  await p.evaluate((EV2) => showShowsSection([EV2]), EV2);
  await p.waitForTimeout(200);
  s = await p.evaluate(() => ({
    noBank: !document.getElementById('shows-container').textContent.includes('계좌이체 예매'),
    qtyMax: document.querySelectorAll('#showQty option').length,
  }));
  chk('무료 공연: 계좌 안내 없음 + 매수 2매 상한', s.noBank && s.qtyMax === 2, `${s.qtyMax}옵션`);

  // ── 10. 매진 공연: 폼 없음
  await p.evaluate((EV3) => showShowsSection([EV3]), EV3);
  await p.waitForTimeout(200);
  s = await p.evaluate(() => ({
    noForm: !document.getElementById('showName'),
    label: document.getElementById('shows-container').textContent.includes('매진'),
  }));
  chk('매진 공연: 예매 폼 없음', s.noForm && s.label);

  chk('pageerror 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  await br.close();
  process.exit(fail ? 1 : 0);
})();
