// 서버 경유 쓰기(gw 래퍼, 2026-11-10): supabaseClient.from(...) 의 쓰기·개인정보 읽기가 /gatheo-api 로 가는지,
// 세션 재발급·폴백·전용 액션(대관 조회)이 동작하는지.
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-gatheo-gw.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const FAKE_SB = `
(function () {
  window.__sbCalls = [];
  function builder(table) {
    const st = { table, op: 'select' };
    const b = {};
    ['select','eq','neq','in','is','not','lt','gte','lte','gt','order','limit','range','maybeSingle','single'].forEach(k => { b[k] = () => b; });
    ['insert','update','delete','upsert'].forEach(k => { b[k] = () => { st.op = k; return b; }; });
    b.then = (res, rej) => { window.__sbCalls.push(table + ':' + st.op); return Promise.resolve({ data: st.op === 'select' ? [] : null, error: null }).then(res, rej); };
    return b;
  }
  window.__sbSession = null;
  window.__fakeSb = { from: builder,
    auth: { signOut: async () => ({}), getSession: async () => ({ data: { session: window.__sbSession } }), getUser: async () => ({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} };
})();`;

(async () => {
  const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
  const p = await ctx.newPage();
  const api = []; let mode = 'ok'; // ok | 401once | 501
  await p.route('**://**', async r => {
    const u = new URL(r.request().url());
    if (u.hostname !== '127.0.0.1') return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    if (u.pathname !== '/gatheo-api') return r.continue();
    const body = JSON.parse(r.request().postData() || '{}'); api.push(body);
    const send = (status, obj) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (mode === '501') return r.fulfill({ status: 501, body: 'no' });
    if (body.action === 'ping') return send(200, { ok: true });
    if (body.action === 'login') return send(200, { ok: true, session: 'new-session', exp: Date.now() + 86400e3, kakao_id: 'k-me', profile: null });
    if (body.action === 'perf_lookup') return send(200, { ok: true, booking: body.phone === '01012345678' ? { id: 'pb1', name: '고객', booking_code: body.code, phone: '010-1234-5678', status: 'pending', date: '2026-12-01', start_time: '10:00', end_time: '12:00', headcount: 5, purpose: '공연', created_at: new Date().toISOString() } : null });
    if (body.action === 'client_errors') return send(200, { ok: true, rows: [
      { id: 2, created_at: new Date().toISOString(), message: "TypeError: Cannot read properties of null (reading 'id')", stack: 'at renderX (/index.html:100:5)', page: 'gatheo/reservation', role: 'member', ua: 'iPhone KAKAOTALK' },
      { id: 1, created_at: new Date().toISOString(), message: "TypeError: Cannot read properties of null (reading 'id')", page: 'gatheo/home', role: 'admin', ua: 'Android' }] });
    if (body.action === 'backup_tables') return send(200, { ok: true, tables: ['profiles', 'reservations', 'band_pins'], page: 2 });
    if (body.action === 'backup_table') {
      if (body.table === 'band_pins') return send(200, { ok: true, missing: true, rows: [] });
      if (body.table === 'reservations') return send(200, body.offset ? { ok: true, rows: [{ id: 3 }], more: false } : { ok: true, rows: [{ id: 1 }, { id: 2 }], more: true });
      return send(200, { ok: true, rows: [{ id: 'p1', name: '홍길동' }], more: false });
    }
    if (mode === '401once' && body.session === 'old-session') return send(401, { ok: false, message: '로그인이 필요합니다.' });
    if (body.table === 'notices') return send(200, { data: null, error: { message: '이 작업을 할 권한이 없습니다.', code: 'FORBIDDEN' } });
    if (body.table === 'profiles') return send(200, { data: [{ id: 'a1', name: '홍길동', status: 'approved', kakao_id: 'k-me' }], error: null });
    return send(200, { data: [{ id: 'srv-1' }], error: null });
  });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.addScriptTag({ content: FAKE_SB });
  const setup = () => p.evaluate(() => {
    document.getElementById('portalLoadingScreen')?.remove();
    _gwDown = false; window.__sbCalls.length = 0; window.__sbSession = null; window.__kakaoTok = null;
    window.Kakao = { isInitialized: () => true, Auth: { getAccessToken: () => window.__kakaoTok } };
    const c = Object.assign({}, window.__fakeSb); c.from = window.__fakeSb.from; _gwInstall(c); supabaseClient = c;
    state.user = { nickname: '홍길동', kakaoId: 'k-me', authType: 'kakao', role: '일반' }; state.bandProfile = null;
    localStorage.setItem('gaa_session', JSON.stringify({ t: 'old-session', e: Date.now() + 86400e3, k: 'k-me' }));
  });
  const sbCalls = () => p.evaluate(() => window.__sbCalls.slice());

  // 1. 쓰기는 서버로
  await setup(); api.length = 0;
  let r = await p.evaluate(async () => await supabaseClient.from('comments').insert([{ content: '안녕' }]).select().single());
  chk('쓰기 → /gatheo-api db', api.length === 1 && api[0].action === 'db' && api[0].table === 'comments' && api[0].session === 'old-session' && JSON.stringify(api[0].calls) === JSON.stringify([['insert', [{ content: '안녕' }]], ['select'], ['single']]), JSON.stringify(api[0]));
  chk('응답 모양(data/error)', r.error === null && Array.isArray(r.data) && r.data[0].id === 'srv-1');
  chk('직접 쓰기 없음', (await sbCalls()).length === 0);
  r = await p.evaluate(async () => await supabaseClient.from('reservations').update({ status: 'approved' }).eq('id', 'r1').in('status', ['pending']));
  chk('필터 체인 기록', JSON.stringify(api[1].calls) === JSON.stringify([['update', { status: 'approved' }], ['eq', 'id', 'r1'], ['in', 'status', ['pending']]]));
  r = await p.evaluate(async () => await supabaseClient.from('notices').insert([{ title: 'x' }]));
  chk('서버 거절이 error 로', r.error && r.error.code === 'FORBIDDEN' && /권한/.test(r.error.message) && (await sbCalls()).length === 0);

  // 2. 읽기: profiles·대관 민감 컬럼만 서버, 나머지 직접
  api.length = 0;
  r = await p.evaluate(async () => await supabaseClient.from('profiles').select('*').eq('kakao_id', 'k-me').maybeSingle());
  chk('profiles 읽기 → 서버', api.length === 1 && api[0].table === 'profiles' && api[0].calls[0][0] === 'select');
  await p.evaluate(async () => { await supabaseClient.from('reservations').select('*'); await supabaseClient.from('performance_bookings').select('id, date, start_time,end_time,status,created_at'); await supabaseClient.from('band_slot_defs').insert({ a: 1 }); });
  chk('예약 읽기·대관 달력 컬럼·합주팀 표는 직접', api.length === 1 && JSON.stringify(await sbCalls()) === JSON.stringify(['reservations:select', 'performance_bookings:select', 'band_slot_defs:insert']), JSON.stringify(await sbCalls()));
  await p.evaluate(async () => { await supabaseClient.from('performance_bookings').select('*').order('created_at', { ascending: false }); });
  chk('대관 명단(*) → 서버', api.length === 2 && api[1].table === 'performance_bookings');
  await p.evaluate(async () => { const q = supabaseClient.from('comments').delete().eq('id', 'c1'); await q; await q; });
  chk('같은 빌더를 두 번 기다려도 한 번만 실행', api.length === 3);

  // 3. 세션 만료 → 카카오 토큰으로 재발급 후 재시도
  await setup(); api.length = 0; mode = '401once';
  await p.evaluate(() => { window.__kakaoTok = 'kt-1'; });
  r = await p.evaluate(async () => await supabaseClient.from('comments').insert([{ content: 'x' }]));
  chk('401 → login → 재시도 성공', api.map(a => a.action).join() === 'db,login,db' && api[2].session === 'new-session' && r.error === null, api.map(a => a.action).join());
  chk('새 세션 저장', await p.evaluate(() => JSON.parse(localStorage.getItem('gaa_session')).t) === 'new-session');
  mode = 'ok';

  // 4. 세션 없음 + 카카오 토큰 → 자동 교환 / 다른 계정 세션은 버림
  await setup(); api.length = 0;
  await p.evaluate(() => { localStorage.setItem('gaa_session', JSON.stringify({ t: 'someone-else', e: Date.now() + 86400e3, k: 'k-other' })); window.__kakaoTok = 'kt-2'; });
  await p.evaluate(async () => await supabaseClient.from('teams').insert([{ name: 't' }]));
  chk('다른 계정 세션 폐기 후 교환', api[0].action === 'login' && api[0].kakao_token === 'kt-2' && api[1].session === 'new-session');

  // 5. 합주팀 화면: sb_token + prefer
  await setup(); api.length = 0;
  await p.evaluate(() => { window.__sbSession = { access_token: 'jwt-band' }; state.bandProfile = { id: 'b1' }; document.getElementById('band-main-content').classList.remove('hidden'); });
  await p.evaluate(async () => await supabaseClient.from('time_blocks').update({ skip_dates: [] }).eq('id', 'b1'));
  chk('합주팀 화면 → sb_token·prefer sb(카카오 세션도 함께)', api[0].sb_token === 'jwt-band' && api[0].prefer === 'sb' && api[0].session === 'old-session', JSON.stringify(api[0]));
  await p.evaluate(() => { document.getElementById('band-main-content').classList.add('hidden'); });
  await p.evaluate(async () => await supabaseClient.from('time_blocks').delete().eq('id', 'b1'));
  chk('게더링 화면이면 prefer 없음', api[1].sb_token === 'jwt-band' && !api[1].prefer);
  await p.evaluate(() => { localStorage.removeItem('gaa_session'); state.user = null; });
  await p.evaluate(async () => await supabaseClient.from('profiles').select('*').eq('id', 'b1').single());
  chk('카카오 세션 없으면 prefer sb', api[2].prefer === 'sb' && !api[2].session);

  // 6. 서버 함수 없음(501) → 종전처럼 직접
  await setup(); api.length = 0; mode = '501';
  r = await p.evaluate(async () => await supabaseClient.from('comments').insert([{ content: 'x' }]));
  chk('501 → 직접 호출 폴백', r.error === null && JSON.stringify(await sbCalls()) === JSON.stringify(['comments:insert']) && await p.evaluate(() => _gwDown) === true);
  await p.evaluate(async () => await supabaseClient.from('profiles').select('*'));
  chk('이후엔 서버를 다시 부르지 않음', api.length === 1 && (await sbCalls()).length === 2);
  chk('부팅 세션 확인: 서버 없으면 통과', await p.evaluate(async () => { localStorage.removeItem('gaa_session'); return await _gwBootSessionOk('k-me'); }) === true);
  mode = 'ok';

  // 7. 부팅 세션 확인
  await setup();
  chk('세션 있으면 통과', await p.evaluate(async () => await _gwBootSessionOk('k-me')) === true);
  chk('다른 계정 세션이면 재로그인', await p.evaluate(async () => await _gwBootSessionOk('k-other')) === false);
  await p.evaluate(() => { localStorage.removeItem('gaa_session'); window.__kakaoTok = 'kt-3'; });
  chk('세션 없고 토큰 있으면 교환', await p.evaluate(async () => await _gwBootSessionOk('k-me')) === true);
  await p.evaluate(() => { localStorage.removeItem('gaa_session'); window.__kakaoTok = null; });
  chk('세션·토큰 없고 서버 살아 있으면 재로그인', await p.evaluate(async () => await _gwBootSessionOk('k-me')) === false);

  // 8. 대관 조회 = 전용 액션(연락처 맞는 건만 내려옴)
  await setup(); api.length = 0;
  await p.evaluate(() => { showPerformanceBookingSection(); });
  await p.waitForTimeout(500);
  const hasLookup = await p.evaluate(() => { renderPerfLookup(); return !!document.getElementById('perfLookupCode'); });
  if (hasLookup) {
    await p.evaluate(() => { document.getElementById('perfLookupCode').value = 'ABC234'; document.getElementById('perfLookupPhone').value = '010-1234-5678'; });
    await p.evaluate(async () => await lookupPerfBooking());
    const a = api.find(x => x.action === 'perf_lookup');
    chk('조회는 perf_lookup(신원 없이)', !!a && a.code === 'ABC234' && a.phone === '01012345678' && !a.session, JSON.stringify(a));
    chk('조회 카드 표시', (await p.evaluate(() => document.getElementById('perfLookupCard').textContent)).includes('ABC234'));
    await p.evaluate(() => { document.getElementById('perfLookupPhone').value = '010-9999-9999'; });
    await p.evaluate(async () => await lookupPerfBooking());
    chk('연락처 다르면 못 찾음', /찾을 수 없습니다/.test(await p.evaluate(() => document.getElementById('perfLookupResult').textContent)));
  } else chk('조회 폼을 찾음', false);

  // 9. 운영 도구: 오류 기록(같은 메시지 묶음) + 백업 내려받기
  await setup(); api.length = 0;
  await p.evaluate(() => { state.user.role = '운영 총괄'; loginUI('홍길동'); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { state.adminTab = 'ops'; setGatheOTab('admin'); });
  await p.waitForTimeout(800);
  const ops = await p.evaluate(() => ({ tab: [...document.querySelectorAll('.admin-subtab')].some(e => e.textContent.includes('운영 도구')), errs: document.querySelectorAll('.ops-err').length, meta: (document.querySelector('.ops-err-meta') || {}).textContent || '' }));
  chk('운영 도구 탭 + 오류 묶음 1건(2회)', ops.tab && ops.errs === 1 && /2회/.test(ops.meta) && /멤버/.test(ops.meta), JSON.stringify(ops));
  await p.evaluate(() => { window.__dl = null; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { name: this.download, href: this.href }; return; } return oc.call(this); }; });
  await p.click('#opsBackupBtn'); await p.waitForTimeout(800);
  const dl = await p.evaluate(async () => { if (!window.__dl) return null; const j = await (await fetch(window.__dl.href)).json(); return { name: window.__dl.name, tables: Object.keys(j.tables), res: j.tables.reservations.length, missing: j.missing, msg: document.getElementById('opsBackupMsg').textContent }; });
  chk('백업 파일: 표 2개·쪽 넘김 3행·없는 표 기록', dl && /^gatherallaround-backup-\d{8}\.json$/.test(dl.name) && dl.tables.join() === 'profiles,reservations' && dl.res === 3 && dl.missing.join() === 'band_pins' && /완료/.test(dl.msg), JSON.stringify(dl));
  await p.evaluate(() => { state.user.role = '일반'; state.adminTab = 'ops'; });
  chk('일반 멤버에겐 운영 도구 없음', await p.evaluate(async () => { const d = document.createElement('div'); await renderAdminOpsSection(d); return /운영 총괄만/.test(d.textContent); }));

  // 10. 브라우저 오류 수집: 같은 메시지는 한 번, /client-log 로
  const logs = [];
  await p.route('**/client-log', r => { logs.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 204, body: '' }); });
  await p.evaluate(() => { window.__gaaLogTest = true; location.hash = '#gatheo/board'; _gaaReportError('error', 'TypeError: boom', 'at x', '/index.html:1:1'); _gaaReportError('error', 'TypeError: boom', 'at x', ''); _gaaReportError('promise', 'Other', '', ''); _gaaReportError('error', 'Script error.', '', ''); });
  await p.waitForTimeout(2000);
  const sentErrs = logs.flatMap(l => l.errors || []);
  chk('오류 2건만 전송(중복·빈 Script error 제외)', sentErrs.length === 2 && sentErrs[0].message === 'TypeError: boom' && sentErrs[0].page === 'gatheo/board' && sentErrs[1].kind === 'promise', JSON.stringify(sentErrs));
  await p.evaluate(() => { window.__gaaLogTest = false; _gaaReportError('error', 'local only', '', ''); });
  await p.waitForTimeout(1700);
  chk('로컬에서는 보내지 않음', logs.flatMap(l => l.errors || []).length === 2);

  chk('pageerror 없음', errs.length === 0, errs.join(' | '));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  await br.close();
  process.exit(fail ? 1 : 0);
})();
