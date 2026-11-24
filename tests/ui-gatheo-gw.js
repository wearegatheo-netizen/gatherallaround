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
  const api = []; let mode = 'ok'; // ok | 401once | 501 | nofn
  let merged = false, window_members = null; // 계정 통합 절(11)에서만 쓴다
  const gone = new Set();                     // 삭제·탈퇴 절(12)에서 지워진 프로필 id
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
    if (body.action === 'profile_merge') {
      const E = { id: 'e1', name: '노희지', email: 'h@example.com', phone: '010-5825-4611', role: '세션장', status: 'approved', created_at: '2026-05-10T00:00:00Z', kakao: false, login: true };
      const K = { id: 'k1', name: '노희지', email: '', phone: '010-5825-4611', role: '일반', status: 'approved', created_at: '2026-11-23T00:00:00Z', kakao: true, login: false };
      if (body.dry) return send(200, { ok: true, dry: true, keep: E, drop: K, swappable: false, kakao_lost: false });
      if (mode === 'nofn') return send(200, { ok: false, error: 'no_function', message: '통합 기능을 쓰려면 Supabase SQL Editor 에서 20261123_profile_merge.sql 을 한 번 실행해야 합니다.' });
      merged = true;
      return send(200, { ok: true, merged: true, keep_id: body.keep_id, kakao_linked: true, moved: {} });
    }
    if (body.action === 'profile_delete') {
      if (mode === 'nofn') return send(200, { ok: false, error: 'no_function', message: '이 기능을 쓰려면 Supabase SQL Editor 에서 20261124_profile_delete.sql 을 한 번 실행해야 합니다.', deleted: 0 });
      body.ids.forEach(id => gone.add(id)); return send(200, { ok: true, deleted: body.ids.length, skipped: 0 });
    }
    if (body.action === 'profile_withdraw') {
      if (mode === 'nofn') return send(200, { ok: false, error: 'no_function', message: '이 기능을 쓰려면 Supabase SQL Editor 에서 20261124_profile_delete.sql 을 한 번 실행해야 합니다.' });
      gone.add(body.profile_id); return send(200, { ok: true, withdrawn: true, auth_left: false });
    }
    if (body.table === 'profiles' && window_members) {
      const rows = window_members.filter(m => !(merged && m.id === 'k1') && !gone.has(m.id));
      const one = (body.calls || []).some(c => c[0] === 'single' || c[0] === 'maybeSingle');
      return send(200, { data: one ? (rows.find(m => (body.calls || []).some(c => c[0] === 'eq' && String(c[2]) === String(m[c[1]]))) || null) : rows, error: null });
    }
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

  // 11. 관리자 › 멤버 목록의 [중복 · 통합] — 같은 사람의 두 계정을 하나로(서버 profile_merge)
  await setup(); api.length = 0;
  window_members = [
    { id: 'k1', name: '노희지', phone: '010-5825-4611', email: '', kakao_id: '4000000001', role: '일반', status: 'approved', instruments: '베이스', created_at: '2026-11-23T00:00:00Z' },
    { id: 'e1', name: '노희지', phone: '01058254611', email: 'h@example.com', kakao_id: null, role: '세션장', status: 'approved', instruments: '베이스', created_at: '2026-05-10T00:00:00Z' },
    { id: 'o1', name: '다른사람', phone: '010-1111-2222', email: 'o@example.com', kakao_id: null, role: '일반', status: 'approved', instruments: '드럼', created_at: '2026-01-01T00:00:00Z' },
    { id: 'b1', name: '노희지', phone: '010-5825-4611', member_type: 'band', status: 'approved', created_at: '2026-01-01T00:00:00Z' },
  ];
  const drawMembers = (role) => p.evaluate((a) => {
    state.user.role = a.role; state.allMembers = a.members.filter(m => m.member_type !== 'band'); gtSheetClose();
    let el = document.getElementById('memberList'); if (!el) { el = document.createElement('div'); el.id = 'memberList'; document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;left:0;top:0;width:420px;z-index:9000;background:#fff';
    renderAdminMemberListEl(el);
    return [...el.querySelectorAll('.admin-member-row')].map(r => r.id.replace('admin-member-row-', '') + ':' + (r.querySelector('button[onclick^="gtMergeSheet"]') ? 'Y' : 'N')).join(' ');
  }, { role, members: window_members });
  chk('통합 버튼: 전화번호·이름이 같은 두 계정에만(운영 총괄)', (await drawMembers('운영 총괄')).split(' ').sort().join(' ') === 'e1:Y k1:Y o1:N');
  chk('통합 버튼: 운영 총괄이 아니면 없음', !/Y/.test(await drawMembers('총괄')));
  await drawMembers('운영 총괄');
  await p.click('#admin-member-row-k1 button[onclick^="gtMergeSheet"]'); await p.waitForSelector('#gtMergeRunBtn', { timeout: 5000 });
  const plan = api.find(a => a.action === 'profile_merge' && a.dry);
  const sheet = await p.evaluate(() => ({ cards: [...document.querySelectorAll('#gtMergeBody .merge-card')].map(c => c.className.replace('merge-card ', '') + ':' + c.dataset.id).join(' '), text: document.getElementById('gtMergeBody').innerText, swap: !!document.querySelector('#gtMergeBody button[onclick*="\'k1\')"]:not(#gtMergeRunBtn)') }));
  chk('통합 시트: 계획 조회(dry) → 남는 계정 = 이메일 계정, 없어지는 계정 = 카카오 계정', !!plan && plan.a_id === 'k1' && plan.b_id === 'e1' && sheet.cards === 'keep:e1 drop:k1', sheet.cards);
  chk('통합 시트: 로그인 방식·옮겨지는 것·되돌릴 수 없음 안내, 바꾸기 버튼 없음', /이메일 로그인/.test(sheet.text) && /카카오 로그인/.test(sheet.text) && /남는 계정으로 옮겨집니다/.test(sheet.text) && /되돌릴 수 없습니다/.test(sheet.text) && !/남길 계정 바꾸기/.test(sheet.text), sheet.text.slice(0, 60));
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/merge-sheet.png' });
  mode = 'nofn'; await p.click('#gtMergeRunBtn'); await p.waitForTimeout(600);
  chk('통합 실행: DB 함수가 없으면 시트 안에 SQL 안내(목록 그대로)', /20261123_profile_merge\.sql/.test(await p.textContent('#gtMergeResult')) && await p.evaluate(() => state.allMembers.length === 3));
  mode = 'ok'; await p.click('#gtMergeRunBtn'); await p.waitForFunction(() => !document.getElementById('gtSheet'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(500);
  const run = api.filter(a => a.action === 'profile_merge' && !a.dry).pop();
  const after = await p.evaluate(() => ({ ids: state.allMembers.map(m => m.id).sort().join(), rows: document.querySelectorAll('#memberList .admin-member-row').length, btns: document.querySelectorAll('#memberList button[onclick^="gtMergeSheet"]').length, toast: (document.getElementById('auto-toast') || {}).textContent || '' }));
  chk('통합 실행: 남길 id·없앨 id 전송 → 목록에서 사라지고 통합 버튼도 없어짐', !!run && run.keep_id === 'e1' && run.drop_id === 'k1' && after.ids === 'e1,o1' && after.rows === 2 && after.btns === 0 && /통합했습니다/.test(after.toast), JSON.stringify(after));
  await p.evaluate(() => { document.getElementById('memberList')?.remove(); state.user.role = '일반'; });
  window_members = null;

  // 12. 거절된 멤버 삭제(운영 총괄) + 회원 탈퇴(마이)
  await setup(); api.length = 0; merged = false; gone.clear();
  window_members = [
    { id: 'a1', name: '홍길동', phone: '010-0000-0001', email: '', kakao_id: 'k-me', role: '일반', status: 'approved', instruments: '기타', created_at: '2026-01-01T00:00:00Z' },
    { id: 'r1', name: '거절일', phone: '010-0000-0002', email: 'r1@example.com', kakao_id: null, role: '일반', status: 'rejected', created_at: '2026-02-01T00:00:00Z' },
    { id: 'r2', name: '거절이', phone: '010-0000-0003', email: '', kakao_id: 'k-r2', role: '일반', status: 'rejected', created_at: '2026-03-01T00:00:00Z' },
    { id: 'r3', name: '거절삼', phone: '010-0000-0004', email: '', kakao_id: 'k-r3', role: '일반', status: 'rejected', created_at: '2026-04-01T00:00:00Z' },
  ];
  const rejView = () => p.evaluate(() => ({ rows: [...document.querySelectorAll('#memberList .admin-member-row')].map(r => r.id.replace('admin-member-row-', '') + ':' + (r.querySelector('button[onclick^="deleteRejectedMembers"]') ? 'Y' : 'N')).sort().join(' '), all: !!document.getElementById('rejectedDeleteAllBtn') }));
  await drawMembers('총괄');
  let rv = await rejView();
  chk('거절 삭제 버튼: 운영 총괄이 아니면 없음', !/Y/.test(rv.rows) && !rv.all, JSON.stringify(rv));
  await drawMembers('운영 총괄'); rv = await rejView();
  chk('거절 삭제 버튼: 거절된 줄에만 [삭제] + 묶음 머리 [전체 삭제]', rv.rows === 'a1:N r1:Y r2:Y r3:Y' && rv.all, JSON.stringify(rv));
  const dialogs = []; p.on('dialog', d => dialogs.push(d.message()));
  mode = 'nofn'; await p.click('#admin-member-row-r1 button[onclick^="deleteRejectedMembers"]'); await p.waitForTimeout(700);
  chk('거절 삭제: DB 함수가 없으면 SQL 안내, 목록 그대로', /20261124_profile_delete\.sql/.test(await p.evaluate(() => (document.getElementById('auto-toast') || {}).textContent || '')) && (await rejView()).rows === 'a1:N r1:Y r2:Y r3:Y');
  mode = 'ok'; api.length = 0; await p.click('#admin-member-row-r1 button[onclick^="deleteRejectedMembers"]'); await p.waitForTimeout(800);
  let del = api.find(a => a.action === 'profile_delete');
  chk('거절 삭제: 한 줄 삭제 → 그 id 만 전송, 목록에서 사라짐', !!del && del.ids.join() === 'r1' && (await rejView()).rows === 'a1:N r2:Y r3:Y', JSON.stringify(del && del.ids));
  chk('거절 삭제: 확인창에 「다시 가입 신청 가능」 안내', dialogs.some(d => /거절일/.test(d) && /다시 가입 신청/.test(d) && /되돌릴 수 없습니다/.test(d)), dialogs.slice(-1)[0]);
  api.length = 0; await p.click('#rejectedDeleteAllBtn'); await p.waitForTimeout(800);
  del = api.find(a => a.action === 'profile_delete');
  chk('거절 삭제: [전체 삭제] → 남은 거절 계정 전부', !!del && del.ids.slice().sort().join() === 'r2,r3' && (await rejView()).rows === 'a1:N' && !(await rejView()).all, JSON.stringify(del && del.ids));
  await p.evaluate(() => { document.getElementById('memberList')?.remove(); });

  // 회원 탈퇴 — 운영 총괄은 안내만
  await p.evaluate(() => { state.user.role = '운영 총괄'; gtWithdrawSheet(); });
  chk('탈퇴: 운영 총괄은 역할을 넘긴 뒤(입력 칸 없음)', await p.evaluate(() => /역할을 넘긴 뒤/.test((document.getElementById('gtWithdrawBody') || {}).textContent || '') && !document.getElementById('gtWithdrawConfirm')));
  await p.evaluate(() => { gtSheetClose(); state.user.role = '일반'; state.cachedMembers = [{ id: 'a1', name: '홍길동', kakao_id: 'k-me', status: 'approved', role: '일반' }]; loginUI('홍길동'); });
  await p.waitForTimeout(600);
  await p.evaluate(() => setGatheOTab('mypage')); await p.waitForSelector('#gtWithdrawLink', { timeout: 6000 });
  const linkBox = await p.evaluate(() => { const b = document.getElementById('gtWithdrawLink'); const r = b.getBoundingClientRect(); return { h: Math.round(r.height), text: b.textContent }; });
  chk('탈퇴: 마이 맨 아래 「회원 탈퇴」 링크(누르는 영역 32px 이상)', linkBox.text === '회원 탈퇴' && linkBox.h >= 32, JSON.stringify(linkBox));
  await p.click('#gtWithdrawLink'); await p.waitForSelector('#gtWithdrawConfirm');
  const wtxt = await p.textContent('#gtWithdrawBody');
  chk('탈퇴 안내: 지워지는 것·남는 것·되돌릴 수 없음', /지워지는 것/.test(wtxt) && /남는 것/.test(wtxt) && /탈퇴한 멤버/.test(wtxt) && /되돌릴 수 없습니다/.test(wtxt));
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/withdraw-sheet.png' });
  api.length = 0; await p.click('#gtWithdrawRunBtn'); await p.waitForTimeout(300);
  chk('탈퇴: 확인 글자를 안 넣으면 요청 없음', /「탈퇴」/.test(await p.textContent('#gtWithdrawResult')) && !api.some(a => a.action === 'profile_withdraw'));
  await p.fill('#gtWithdrawConfirm', '탈퇴'); await p.click('#gtWithdrawRunBtn'); await p.waitForTimeout(900);
  const wd = api.find(a => a.action === 'profile_withdraw');
  const afterW = await p.evaluate(() => ({ user: !!state.user, portal: !document.getElementById('portal-page').classList.contains('hidden'), main: !document.getElementById('main-content').classList.contains('hidden'),
    sess: localStorage.getItem('gaa_session'), uid: localStorage.getItem('gaa_kakao_uid'), sheet: !!document.getElementById('gtSheet'), toast: (document.getElementById('auto-toast') || {}).textContent || '' }));
  chk('탈퇴: 내 프로필 id 로 요청', !!wd && wd.profile_id === 'a1' && wd.session === 'old-session', JSON.stringify(wd));
  chk('탈퇴 뒤: 로그아웃 상태·포털·로그인 흔적 삭제', !afterW.user && afterW.portal && !afterW.main && !afterW.sess && !afterW.uid && !afterW.sheet && /탈퇴가 완료/.test(afterW.toast), JSON.stringify(afterW));
  window_members = null;

  chk('pageerror 없음', errs.length === 0, errs.join(' | '));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  await br.close();
  process.exit(fail ? 1 : 0);
})();
