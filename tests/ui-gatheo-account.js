// 게더링 계정: 비밀번호 재설정 흐름 + 이메일 계정 ↔ 카카오 연결(2026-11-23)
//   실제 supabase-js(vendor)를 쓰고 supabase.co · /send-email · /gatheo-api 만 가짜로 받는다 — 링크로 들어왔을 때 새 비밀번호 화면이
//   뜨는지(종전엔 포털로 튕김), 토큰이 주소에 남지 않는지, 연결이 이메일 세션 + 카카오 확인 둘 다로만 되는지.
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-gatheo-account.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const UID = 'a0000000-0000-4000-8000-000000000001';
const EMAIL = 'me@example.com';
const JWT = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: UID, email: EMAIL, aud: 'authenticated', role: 'authenticated', exp: now + 3600, iat: now }) + '.c2ln';
const USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const SESSION = { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt-1', user: USER };
const GOOD = 'a'.repeat(56), BAD = 'b'.repeat(56);

(async () => {
  const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  // 시나리오마다 새 컨텍스트(저장소 초기화). m = 가짜 서버 설정, log = 받은 요청
  async function open(pathAndHash, m = {}) {
    const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    const p = await ctx.newPage();
    const log = { sb: [], api: [], mail: [], dialogs: [] };
    const profile = () => ({ id: UID, name: '홍길동', email: EMAIL, phone: '010-1111-2222', status: 'approved', role: '일반', member_type: null, instruments: '기타', kakao_id: m.kakaoId || null });
    await p.route('**://**', async r => {
      const req = r.request(), u = new URL(req.url());
      const send = (status, obj) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
      if (u.hostname === '127.0.0.1') {
        if (u.pathname === '/client-log') return r.fulfill({ status: 204, body: '' });
        if (u.pathname === '/send-email') {
          const body = JSON.parse(req.postData() || '{}'); log.mail.push(body);
          if (m.mail === 404) return r.fulfill({ status: 404, body: '' });
          if (m.mail === 429) return send(429, { ok: false, error: 'rate_limited' });
          if (m.mail === 'off') return send(200, { ok: false, skipped: 'email-disabled' });
          return send(200, { ok: true });
        }
        if (u.pathname === '/gatheo-api') {
          const body = JSON.parse(req.postData() || '{}'); log.api.push(body);
          if (body.action === 'ping') return send(200, { ok: true });
          if (body.action === 'login') return send(200, { ok: true, session: 'srv-session', exp: Date.now() + 86400e3, kakao_id: 'k-new', profile: null });
          if (body.action === 'identity_sync') return send(200, { ok: true, moved: 2 });
          if (body.action === 'kakao_link_self') {
            if (m.linkFail) return send(409, { ok: false, error: 'kakao_taken', message: '이 카카오 계정은 이미 다른 게더링 계정에 연결되어 있습니다.' });
            m.kakaoId = 'k-new';
            return send(200, { ok: true, linked: true, kakao_id: 'k-new', status: 'approved', moved: 1 });
          }
          if (body.action === 'db' && body.table === 'profiles') {
            const one = (body.calls || []).some(c => c[0] === 'single' || c[0] === 'maybeSingle');
            const byKakao = (body.calls || []).find(c => c[0] === 'eq' && c[1] === 'kakao_id');
            const row = byKakao && String(byKakao[2]) !== String(m.kakaoId) ? null : profile();
            return send(200, { data: one ? row : (row ? [row] : []), error: null });
          }
          return send(200, { data: [], error: null });
        }
        return r.continue();
      }
      if (/supabase\.co$/.test(u.hostname)) {
        const method = req.method(); let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) {}
        log.sb.push({ method, path: u.pathname, q: u.search, body, auth: req.headers()['authorization'] || '' });
        if (u.pathname === '/auth/v1/verify') return body && body.token_hash === GOOD ? send(200, SESSION) : send(403, { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' });
        if (u.pathname === '/auth/v1/user' && method === 'PUT') return m.samePw ? send(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }) : send(200, USER);
        if (u.pathname === '/auth/v1/user') return send(200, USER);
        if (u.pathname === '/auth/v1/logout') return r.fulfill({ status: 204, body: '' });
        if (u.pathname === '/auth/v1/recover') return send(200, {});
        if (u.pathname === '/auth/v1/token') return body && body.password === 'right-pw' ? send(200, SESSION) : send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(200, []);
      }
      return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => { log.dialogs.push(d.message()); d.accept(); });
    await p.goto(`http://127.0.0.1:${PORT}/${pathAndHash}`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof _authResolved !== 'undefined' && _authResolved === true, null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(700);
    return { p, ctx, log, errs, m };
  }
  const view = (p) => p.evaluate(() => {
    const vis = id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && e.offsetParent !== null; };
    return { url: location.pathname + location.search + location.hash, reset: vis('reset-pw-form'), findpw: vis('find-pw-form'), login: vis('email-login-form'), portal: vis('portal-page'), main: vis('main-content'),
      resetMsg: (document.getElementById('resetPwResult') || {}).textContent || '', findMsg: (document.getElementById('findPwResult') || {}).textContent || '',
      loginEmail: (document.getElementById('loginEmail') || {}).value || '', stored: Object.keys(localStorage).filter(k => /^sb-.*-auth-token$/.test(k)).length };
  });
  const submitReset = async (p, a, b) => { await p.fill('#resetPwNew', a); await p.fill('#resetPwConfirm', b); await p.click('#reset-pw-form .email-primary-btn'); await p.waitForTimeout(900); };

  // ── 1. 우리 메일 링크(?pwreset=토큰) ──
  {
    const { p, ctx, log, errs } = await open(`?pwreset=${GOOD}`);
    let v = await view(p);
    chk('1 링크로 들어오면 새 비밀번호 화면(포털 아님)', v.reset && !v.portal && !v.login, JSON.stringify(v));
    chk('1 토큰이 주소에서 지워짐', v.url === '/', v.url);
    chk('1 화면을 열기만 해서는 토큰을 쓰지 않음(메일 검사기가 먼저 열어도 안전)', !log.sb.some(c => c.path === '/auth/v1/verify') && v.stored === 0);
    await submitReset(p, 'newpass1', 'newpass2'); v = await view(p);
    chk('1 확인 불일치 → 인라인 오류, 토큰 미사용', /일치하지/.test(v.resetMsg) && !log.sb.some(c => c.path === '/auth/v1/verify'), v.resetMsg);
    await submitReset(p, 'newpass1', 'newpass1'); v = await view(p);
    const ver = log.sb.find(c => c.path === '/auth/v1/verify'), put = log.sb.find(c => c.path === '/auth/v1/user' && c.method === 'PUT');
    chk('1 변경: 토큰 확인(token_hash·recovery) → 새 비밀번호 저장', !!ver && ver.body.token_hash === GOOD && ver.body.type === 'recovery' && !!put && put.body.password === 'newpass1' && put.auth === 'Bearer ' + JWT, JSON.stringify(put && put.body));
    chk('1 변경 뒤 로그아웃 + 로그인 화면(이메일 채워 둠)', log.sb.some(c => c.path === '/auth/v1/logout') && v.login && !v.reset && v.loginEmail === EMAIL && v.stored === 0, JSON.stringify(v));
    chk('1 오류 없음', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  // ── 2. 만료·사용된 토큰 ──
  {
    const { p, ctx, log } = await open(`?pwreset=${BAD}`);
    await submitReset(p, 'newpass1', 'newpass1'); const v = await view(p);
    chk('2 만료 토큰 → 비밀번호 찾기 화면 + 안내, 비밀번호 저장 시도 없음', v.findpw && !v.reset && /만료|이미 사용/.test(v.findMsg) && !log.sb.some(c => c.method === 'PUT'), JSON.stringify(v));
    await ctx.close();
  }
  // ── 3. 같은 비밀번호 거절 → 다시 입력하면 토큰을 또 쓰지 않는다 ──
  {
    const { p, ctx, log, m } = await open(`?pwreset=${GOOD}`, { samePw: true });
    await submitReset(p, 'oldpass1', 'oldpass1'); let v = await view(p);
    chk('3 이전과 같은 비밀번호 → 한국어 안내, 화면 유지', v.reset && /이전과 다른/.test(v.resetMsg), v.resetMsg);
    m.samePw = false;
    await submitReset(p, 'newpass9', 'newpass9'); v = await view(p);
    chk('3 다시 제출 → 토큰 확인은 한 번만, 성공', log.sb.filter(c => c.path === '/auth/v1/verify').length === 1 && v.login, JSON.stringify(v));
    await ctx.close();
  }
  // ── 4. Supabase 기본 메일 링크(#access_token…type=recovery) ──
  {
    const { p, ctx, log, errs } = await open(`#access_token=${JWT}&expires_in=3600&refresh_token=rt-1&token_type=bearer&type=recovery`);
    let v = await view(p);
    chk('4 해시 링크도 새 비밀번호 화면', v.reset && !v.portal, JSON.stringify(v));
    chk('4 토큰 해시가 주소에서 지워지고 로그인 상태로 저장되지 않음', v.url === '/' && v.stored === 0, v.url + ' stored=' + v.stored);
    await submitReset(p, 'newpass1', 'newpass1'); v = await view(p);
    const put = log.sb.find(c => c.path === '/auth/v1/user' && c.method === 'PUT');
    chk('4 변경 성공 → 로그인 화면', !!put && put.body.password === 'newpass1' && v.login && v.stored === 0, JSON.stringify(v));
    chk('4 오류 없음', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  // ── 5. 만료 오류 해시 ──
  {
    const { p, ctx } = await open('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    const v = await view(p);
    chk('5 만료 오류 링크 → 비밀번호 찾기 화면 + 안내', v.findpw && !v.portal && /만료|이미 사용/.test(v.findMsg) && v.url === '/', JSON.stringify(v));
    await p.click('#find-pw-form .email-secondary-btn'); const v2 = await view(p);
    chk('5 [로그인으로 돌아가기]', v2.login && !v2.findpw);
    await ctx.close();
  }
  // ── 6. 취소 ──
  {
    const { p, ctx, log } = await open(`?pwreset=${GOOD}`);
    await p.click('#reset-pw-form .email-secondary-btn'); await p.waitForTimeout(300); const v = await view(p);
    chk('6 [취소하고 로그인으로] → 로그인 화면, 토큰 미사용', v.login && !v.reset && !log.sb.some(c => c.path === '/auth/v1/verify'));
    chk('6 취소 뒤 재설정 상태 해제', await p.evaluate(() => recoveryMode === false && !window.__pwReset));
    await ctx.close();
  }
  // ── 7. 비밀번호 찾기(메일 보내기) ──
  {
    const goFind = async (p) => { await p.evaluate(() => { showGatheoSection(); document.getElementById('portalLoadingScreen')?.remove(); showFindPw(); }); await p.waitForTimeout(200); };
    const send = async (p, email) => { await p.fill('#findPwEmail', email); await p.click('#find-pw-form .email-primary-btn'); await p.waitForTimeout(700); return view(p); };
    let s = await open('');
    await goFind(s.p); let v = await send(s.p, 'bad-email');
    chk('7 형식 오류는 보내지 않음', /형식/.test(v.findMsg) && s.log.mail.length === 0, v.findMsg);
    v = await send(s.p, EMAIL);
    chk('7 우리 서버로 요청(pw_reset) — Supabase 기본 메일은 안 부름', s.log.mail.length === 1 && s.log.mail[0].action === 'pw_reset' && s.log.mail[0].email === EMAIL && !s.log.sb.some(c => c.path === '/auth/v1/recover'), JSON.stringify(s.log.mail));
    chk('7 안내(스팸함·가입 여부는 알리지 않음)', /보냈습니다/.test(v.findMsg) && /스팸함/.test(v.findMsg), v.findMsg);
    await s.ctx.close();
    for (const mode of [404, 'off']) {
      s = await open('', { mail: mode }); await goFind(s.p); v = await send(s.p, EMAIL);
      const rec = s.log.sb.find(c => c.path === '/auth/v1/recover');
      chk(`7 서버 메일 ${mode === 404 ? '없음(404)' : '꺼짐'} → Supabase 기본 메일로`, !!rec && rec.body.email === EMAIL && /보냈습니다/.test(v.findMsg), v.findMsg);
      if (mode === 404) chk('7 기본 메일의 돌아올 주소는 사이트 루트', /redirect_to=http%3A%2F%2F127\.0\.0\.1%3A\d+%2F(&|$)/.test(rec.q), rec.q);
      await s.ctx.close();
    }
    s = await open('', { mail: 429 }); await goFind(s.p); v = await send(s.p, EMAIL);
    chk('7 요청 과다(429) → 안내만, 기본 메일로 우회하지 않음', /요청이 많습니다/.test(v.findMsg) && !s.log.sb.some(c => c.path === '/auth/v1/recover'), v.findMsg);
    await s.ctx.close();
  }
  // ── 8. 이메일 로그인 → 마이 › 카카오 계정 연결 ──
  const emailLogin = async (p) => {
    await p.evaluate(() => { showGatheoSection(); document.getElementById('portalLoadingScreen')?.remove(); });
    await p.fill('#loginEmail', EMAIL); await p.fill('#loginPassword', 'right-pw'); await p.click('#email-login-form .email-primary-btn');
    await p.waitForFunction(() => state.user && !document.getElementById('main-content').classList.contains('hidden'), null, { timeout: 8000 });
    await p.evaluate(() => document.getElementById('portalLoadingScreen')?.remove());
  };
  const fakeKakao = (p, token = 'kt-new') => p.evaluate((tok) => {
    window.__kakaoLogins = 0;
    window.Kakao = { isInitialized: () => true, init() {}, Auth: { getAccessToken: () => null, setAccessToken() {}, logout(cb) { cb && cb(); },
      login(o) { window.__kakaoLogins++; setTimeout(() => o.success({ access_token: tok }), 20); } },
      API: { request(o) { setTimeout(() => o.success({ id: 1, kakao_account: { profile: { nickname: '길동카카오' } } }), 10); } } };
  }, token);
  {
    const { p, ctx, log, errs } = await open('');
    await emailLogin(p);
    let u = await p.evaluate(() => ({ k: state.user.kakaoId, pid: state.user.profileId, linked: state.user.linkedKakao, auth: state.user.authType }));
    chk('8 연결 전 이메일 멤버: 기록 키 = 계정 id', u.k === UID && u.pid === UID && !u.linked && u.auth === 'email', JSON.stringify(u));
    chk('8 연결 안 된 계정은 기록 맞추기 요청 없음', !log.api.some(a => a.action === 'identity_sync'));
    await p.evaluate(() => setGatheOTab('mypage')); await p.waitForSelector('#gtKakaoLinkRow', { timeout: 6000 });
    chk('8 마이에 「카카오 계정 연결」 줄', /카카오 계정 연결/.test(await p.textContent('#gtKakaoLinkRow')));
    await fakeKakao(p);
    await p.click('#gtKakaoLinkRow');
    await p.waitForFunction(() => state.user && state.user.linkedKakao, null, { timeout: 6000 }).catch(() => {});
    await p.waitForTimeout(500);
    const call = log.api.find(a => a.action === 'kakao_link_self');
    chk('8 연결 요청: 이메일 세션 토큰 + 방금 받은 카카오 토큰(저장된 서버 세션은 안 씀)', !!call && call.sb_token === JWT && call.kakao_token === 'kt-new' && !call.session, JSON.stringify(call));
    chk('8 어느 카카오 계정인지 확인창', log.dialogs.some(d => /길동카카오/.test(d) && /연결/.test(d)), log.dialogs.join(' / '));
    u = await p.evaluate(() => ({ k: state.user.kakaoId, pid: state.user.profileId, linked: state.user.linkedKakao }));
    chk('8 연결 뒤 기록 키 = 카카오 ID, 프로필 id 는 그대로', u.k === 'k-new' && u.pid === UID && u.linked === 'k-new', JSON.stringify(u));
    await p.waitForFunction(() => /연결됨/.test((document.getElementById('gtKakaoLinkRow') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    chk('8 마이 줄이 「연결됨」', /연결됨/.test(await p.textContent('#gtKakaoLinkRow')));
    log.api.length = 0;
    await p.evaluate(() => renderMypagePanel()); await p.waitForTimeout(500);
    const sel = log.api.find(a => a.action === 'db' && a.table === 'profiles' && (a.calls || []).some(c => c[0] === 'single'));
    chk('8 연결 뒤에도 내 프로필은 계정 id 로 조회', !!sel && sel.calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === UID), JSON.stringify(sel && sel.calls));
    chk('8 오류 없음', errs.length === 0, errs.join(' | '));
    if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/account-mypage-linked.png' });
    await ctx.close();
  }
  {
    const { p, ctx, log } = await open('', { linkFail: true });
    await emailLogin(p);
    await p.evaluate(() => setGatheOTab('mypage')); await p.waitForSelector('#gtKakaoLinkRow', { timeout: 6000 });
    await fakeKakao(p); await p.click('#gtKakaoLinkRow'); await p.waitForTimeout(900);
    const u = await p.evaluate(() => ({ k: state.user.kakaoId, linked: state.user.linkedKakao, toast: (document.getElementById('auto-toast') || {}).textContent || '' }));
    chk('8 이미 쓰인 카카오 → 안내, 상태 그대로', u.k === UID && !u.linked && /이미 다른 게더링 계정/.test(u.toast) && log.api.some(a => a.action === 'kakao_link_self'), JSON.stringify(u));
    await ctx.close();
  }
  // ── 9. 이미 연결된 계정으로 이메일 로그인 ──
  {
    const { p, ctx, log } = await open('', { kakaoId: 'k-old' });
    await emailLogin(p); await p.waitForTimeout(600);
    const u = await p.evaluate(() => ({ k: state.user.kakaoId, pid: state.user.profileId, linked: state.user.linkedKakao }));
    chk('9 연결된 계정: 이메일로 로그인해도 기록 키 = 카카오 ID', u.k === 'k-old' && u.pid === UID && u.linked === 'k-old', JSON.stringify(u));
    chk('9 옛 기록 맞추기 한 번', log.api.filter(a => a.action === 'identity_sync').length === 1 && log.api.find(a => a.action === 'identity_sync').sb_token === JWT);
    await p.evaluate(async () => { const { data } = await supabaseClient.auth.getSession(); await checkEmailUserApproval(data.session.user); }); await p.waitForTimeout(500);
    chk('9 같은 브라우저에선 다시 부르지 않음', log.api.filter(a => a.action === 'identity_sync').length === 1);
    await p.evaluate(() => setGatheOTab('mypage')); await p.waitForSelector('#gtKakaoLinkRow', { timeout: 6000 });
    chk('9 마이 줄 「연결됨」', /연결됨/.test(await p.textContent('#gtKakaoLinkRow')));
    await ctx.close();
  }
  // ── 10. 카카오로 처음 들어온 사람: 가입 모달 「기존 계정 연동」 = 이메일 + 비밀번호 ──
  {
    const { p, ctx, log, errs } = await open('');
    await fakeKakao(p);
    await p.evaluate(() => {
      localStorage.setItem('gaa_session', JSON.stringify({ t: 'srv-session', e: Date.now() + 86400e3, k: 'k-new' }));
      state.user = { nickname: '길동카카오', kakaoId: 'k-new' };
      showKakaoSignupModal(); showKakaoLinkView();
    });
    chk('10 연동 화면은 이메일·비밀번호(이름·전화번호 칸 없음)', await p.evaluate(() => !!document.getElementById('klEmail') && !!document.getElementById('klPassword') && !document.getElementById('klName') && !document.getElementById('klPhone')));
    const link = async (pw) => { await p.fill('#klEmail', EMAIL); await p.fill('#klPassword', pw); await p.click('button[onclick="submitKakaoLink()"]'); await p.waitForTimeout(900); };
    await link('wrong-pw');
    chk('10 비밀번호 틀림 → 인라인 오류, 연결 요청 없음', /이메일 또는 비밀번호/.test(await p.textContent('#klResult')) && !log.api.some(a => a.action === 'kakao_link_self'));
    await link('right-pw');
    const call = log.api.find(a => a.action === 'kakao_link_self');
    chk('10 연결 요청: 비밀번호로 받은 이메일 세션 + 내 카카오 세션', !!call && call.sb_token === JWT && call.session === 'srv-session', JSON.stringify(call));
    await p.waitForFunction(() => state.user && state.user.role, null, { timeout: 6000 }).catch(() => {});
    const u = await p.evaluate(() => ({ k: state.user.kakaoId, role: state.user.role, auth: state.user.authType || '', cached: localStorage.getItem('gaa_kakao_uid'),
      modal: !document.getElementById('kakaoSignupModal').classList.contains('hidden'), stored: Object.keys(localStorage).filter(k => /^sb-.*-auth-token$/.test(k)).length }));
    chk('10 연결 뒤 카카오 멤버로 진입(모달 닫힘, 자동 로그인 캐시)', u.k === 'k-new' && u.role === '일반' && u.cached === 'k-new' && !u.modal, JSON.stringify(u));
    chk('10 비밀번호 확인이 이 브라우저의 이메일 로그인 상태를 남기지 않음', u.stored === 0 && u.auth !== 'email');
    chk('10 오류 없음', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  {
    const { p, ctx } = await open('');
    await fakeKakao(p);
    await p.evaluate(() => { state.user = { nickname: '길동카카오', kakaoId: 'k-new' }; showKakaoSignupModal(); showKakaoLinkView(); });
    await p.fill('#klEmail', EMAIL); await p.click('button[onclick="kakaoLinkForgotPw()"]'); await p.waitForTimeout(300);
    const v = await view(p);
    chk('10 [비밀번호를 잊으셨나요?] → 비밀번호 찾기 화면(이메일 옮김)', v.findpw && await p.inputValue('#findPwEmail') === EMAIL, JSON.stringify(v));
    await ctx.close();
  }

  await br.close();
  console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
