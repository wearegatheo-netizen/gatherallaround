// 경로형 섹션 주소(2026-11-05): /perf · /band/times · /gatheo/board/<id> … 처럼 # 없이 들어와도 같은 화면이 뜨는지 실제 브라우저로 확인.
// 두 가지 서빙을 모두 본다 — ① 정적 SPA 폴백(모르는 경로에 index.html 그대로, 머리 인라인 스크립트가 치환)
//                            ② functions/_middleware.js 가 낸 셸(appShellWithRoute: base + replaceState 를 먼저 넣음)
// 서버 없이 Playwright route 로 가짜 출처(http://app.test)에서 저장소 파일을 내준다. 외부 CDN 은 빈 스크립트.
// 실행: NODE_PATH=<scratchpad>/node_modules node tests/ui-path-routes.js
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://app.test';
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const UUID = '11111111-1111-4111-8111-111111111111';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

(async () => {
  const mw = await import(path.join(ROOT, 'functions/_middleware.js'));
  const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

  // login = { delay, status } — 저장된 카카오 로그인(gaa_kakao_uid + 서버 세션)이 있고 프로필 확인(/gatheo-api)이 delay ms 걸리는 방문자.
  //   로그인 확인이 부팅 폴백(1.5초)보다 늦게 끝나는 경우를 본다(2026-11-25 「/perf 로 들어왔는데 포털로 튕김」).
  async function open(mode, urlPath, login, during) {
    const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, locale: 'ko-KR' });
    if (login) await ctx.addInitScript(() => { try { localStorage.setItem('gaa_kakao_uid', 'k-me'); localStorage.setItem('gaa_session', JSON.stringify({ t: 'sess', e: Date.now() + 86400e3, k: 'k-me' })); } catch (_) {} });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route('**/*', async r => {
      const u = new URL(r.request().url());
      if (u.origin !== ORIGIN) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      if (login && u.pathname === '/gatheo-api') {
        const body = JSON.parse(r.request().postData() || '{}');
        const send = (obj) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) }).catch(() => {});
        if (body.action === 'ping') return send({ ok: true });
        if (body.table === 'profiles' && (body.calls || []).some(c => c[0] === 'maybeSingle')) { // 부팅의 내 프로필 확인만 늦게
          await new Promise(x => setTimeout(x, login.delay || 0));
          return send({ data: { id: 'a1', name: '홍길동', status: login.status || 'approved', kakao_id: 'k-me', role: '일반' }, error: null });
        }
        return send({ data: [], error: null });
      }
      const file = path.join(ROOT, decodeURIComponent(u.pathname));
      if (u.pathname !== '/' && file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile())
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      const route = mode === 'middleware' ? mw.appRouteFromPath(u.pathname) : null;
      return r.fulfill({ status: 200, contentType: 'text/html', body: route ? mw.appShellWithRoute(INDEX, route) : INDEX });
    });
    await p.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded' });
    if (during) { await p.waitForTimeout(during.at); await p.evaluate(during.run); }
    await p.waitForTimeout(2600 + ((login && login.delay) || 0) - (during ? during.at : 0));
    const st = await p.evaluate(() => {
      const vis = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); };
      return { path: location.pathname, search: location.search, hash: location.hash,
        portal: vis('portal-page'), perf: vis('performance-booking-page'), shows: vis('shows-page'), community: vis('landing-page-community'),
        band: vis('landing-page-band'), bandTimes: vis('band-schedule-view'), host: vis('host-page'), gatheoLogin: vis('landing-page'),
        gatheoMain: vis('main-content'), pending: vis('pending-screen'), boot: !!document.querySelector('#portalLoadingScreen[data-boot]'),
        returnTo: (() => { try { return sessionStorage.getItem('gaa_return_to'); } catch (_) { return null; } })() };
    });
    return { p, ctx, st, errs };
  }

  for (const mode of ['static', 'middleware']) {
    const tag = mode === 'static' ? '[정적 폴백]' : '[미들웨어 셸]';
    let o = await open(mode, '/perf');
    chk(`${tag} /perf → 주소 /#perf · 공간 대관 화면`, o.st.path === '/' && o.st.hash === '#perf' && o.st.perf && !o.st.portal, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, '/band/times');
    chk(`${tag} /band/times → 고정 가능 시간 화면`, o.st.hash === '#band/times' && o.st.band && o.st.bandTimes, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, '/shows');
    chk(`${tag} /shows → 공연 예매 목록`, o.st.hash === '#shows' && o.st.shows, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, '/shows/ticket/abc234');
    chk(`${tag} /shows/ticket/<소문자 코드> → #shows/ticket/<대문자>`, o.st.hash === '#shows/ticket/ABC234' && o.st.shows, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, '/community/test');
    chk(`${tag} /community/test → 커뮤니티 테스트 탭`, o.st.hash === '#community/test' && o.st.community, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, '/host/');
    chk(`${tag} /host/(끝 슬래시) → 호스트 센터`, o.st.hash === '#host' && o.st.host, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, `/gatheo/board/${UUID}`);
    chk(`${tag} /gatheo/board/<id>(비로그인) → 로그인 화면 + 돌아올 글 저장`, o.st.hash === `#gatheo/board/${UUID}` && o.st.gatheoLogin && o.st.returnTo === `gatheo/board/${UUID}`, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, '/perf?fbclid=abc');
    chk(`${tag} /perf?fbclid= → 쿼리 유지 /?fbclid=abc#perf`, o.st.path === '/' && o.st.search === '?fbclid=abc' && o.st.hash === '#perf' && o.st.perf, JSON.stringify(o.st));
    await o.ctx.close();

    o = await open(mode, '/PERF');
    chk(`${tag} /PERF(대문자) → 공간 대관`, o.st.hash === '#perf' && o.st.perf, JSON.stringify(o.st));
    await o.ctx.close();
  }

  // ── 로그인해 둔 방문자 + 느린 로그인 확인(2026-11-25) — 직통 주소가 포털로 덮이면 안 된다 ──
  //   종전: 1.5초 폴백이 딥링크를 먼저 적용하고, 뒤늦게 끝난 로그인 확인이 「갈 곳 없음 → 포털」로 덮어썼다(주소의 #perf 도 지움).
  const SLOW = { delay: 2300 };
  let o;
  for (const [urlPath, key, hash, name] of [['/perf', 'perf', '#perf', '공간 대관'], ['/shows', 'shows', '#shows', '공연 예매'], ['/community', 'community', '#community', '커뮤니티'], ['/host', 'host', '#host', '호스트 센터'], ['/band/times', 'bandTimes', '#band/times', '고정 가능 시간']]) {
    o = await open('static', urlPath, SLOW);
    chk(`[로그인 확인이 늦을 때] ${urlPath} → ${name} 그대로(포털로 안 튕김)`, o.st[key] && !o.st.portal && o.st.hash === hash && !o.st.boot && !o.errs.length, JSON.stringify(o.st) + o.errs.join('|'));
    await o.ctx.close();
  }
  o = await open('middleware', '/perf?fbclid=abc', SLOW);
  chk('[로그인 확인이 늦을 때] 미들웨어 셸 /perf?fbclid= 도 그대로', o.st.perf && !o.st.portal && o.st.hash === '#perf' && o.st.search === '?fbclid=abc', JSON.stringify(o.st));
  await o.ctx.close();
  o = await open('static', '/perf', { delay: 0 });
  chk('[로그인 확인이 빠를 때] /perf → 공간 대관', o.st.perf && !o.st.portal && o.st.hash === '#perf', JSON.stringify(o.st));
  await o.ctx.close();
  o = await open('static', '/gatheo/mypage', SLOW);
  chk('[로그인 확인이 늦을 때] /gatheo/mypage → 게더링 화면(로그인 폼에서 멈추지 않음)', o.st.gatheoMain && !o.st.portal && !o.st.gatheoLogin && /^#gatheo/.test(o.st.hash), JSON.stringify(o.st));
  await o.ctx.close();
  o = await open('static', '/', SLOW);
  chk('[로그인 확인이 늦을 때] 루트 → 포털(자동 진입 없음)', o.st.portal && !o.st.gatheoMain && !o.st.hash && !o.st.boot, JSON.stringify(o.st));
  await o.ctx.close();
  // 포털에서 기다리는 사이(부팅 화면이 걷힌 뒤) 타일을 눌러 섹션에 들어갔으면, 뒤늦은 로그인 확인이 포털로 되돌리지 않는다
  o = await open('static', '/', { delay: 3200 }, { at: 2500, run: () => showPerformanceBookingSection() });
  chk('[로그인 확인이 늦을 때] 포털에서 먼저 대관으로 들어간 뒤에도 그대로', o.st.perf && !o.st.portal && o.st.hash === '#perf', JSON.stringify(o.st));
  await o.ctx.close();
  // 승인 대기 중인 멤버가 공개 섹션 주소로 들어오면 「승인 대기」 화면이 아니라 그 섹션
  o = await open('static', '/perf', { delay: 0, status: 'pending' });
  chk('승인 대기 멤버: /perf → 공간 대관(대기 화면으로 가로막지 않음)', o.st.perf && !o.st.pending && !o.st.portal, JSON.stringify(o.st));
  await o.ctx.close();
  o = await open('static', '/', { delay: 0, status: 'pending' });
  chk('승인 대기 멤버: 루트는 종전처럼 승인 대기 화면', o.st.pending && !o.st.perf, JSON.stringify(o.st));
  await o.ctx.close();

  // 섹션이 아닌 경로·예전 해시 주소는 종전 그대로
  o = await open('static', '/nope');
  chk('모르는 경로 /nope → 포털(해시 없음)', o.st.portal && !o.st.hash, JSON.stringify(o.st));
  await o.ctx.close();
  o = await open('static', '/#perf');
  chk('예전 해시 주소 /#perf 도 그대로 동작', o.st.path === '/' && o.st.hash === '#perf' && o.st.perf, JSON.stringify(o.st));
  await o.ctx.close();
  o = await open('static', `/show/${UUID}`);
  chk('기존 공유 경로 /show/<id> → #shows/<id>', o.st.hash === `#shows/${UUID}` && o.st.shows, JSON.stringify(o.st));
  await o.ctx.close();

  // 사이트가 만드는 링크는 # 없는 경로형
  o = await open('static', '/');
  const links = await o.p.evaluate(async () => {
    const got = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { got.push(t); } }, configurable: true });
    window.showToast = () => {};
    copyBoardPostLink('11111111-1111-4111-8111-111111111111');
    await new Promise(r => setTimeout(r, 50));
    return got;
  });
  chk('게시글 링크 복사 = /gatheo/board/<id>(# 없음)', links[0] === `${ORIGIN}/gatheo/board/${UUID}`, links[0]);
  await o.ctx.close();
  const src = fs.readdirSync(path.join(ROOT, 'js')).map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n'); // 본 스크립트는 js/app-*.js 로 분리됨(2026-11-10)
  chk('양도 링크·체크인 QR 도 경로형(/#shows/claim·/#host/checkin 없음)', src.includes('`${location.origin}/shows/claim/${out.token}`') && !src.includes("'/#host/checkin/'") && !src.includes('/#shows/claim/'));

  await br.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
