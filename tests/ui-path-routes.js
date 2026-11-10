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

  async function open(mode, urlPath) {
    const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, locale: 'ko-KR' });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route('**/*', async r => {
      const u = new URL(r.request().url());
      if (u.origin !== ORIGIN) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const file = path.join(ROOT, decodeURIComponent(u.pathname));
      if (u.pathname !== '/' && file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile())
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      const route = mode === 'middleware' ? mw.appRouteFromPath(u.pathname) : null;
      return r.fulfill({ status: 200, contentType: 'text/html', body: route ? mw.appShellWithRoute(INDEX, route) : INDEX });
    });
    await p.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);
    const st = await p.evaluate(() => {
      const vis = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); };
      return { path: location.pathname, search: location.search, hash: location.hash,
        portal: vis('portal-page'), perf: vis('performance-booking-page'), shows: vis('shows-page'), community: vis('landing-page-community'),
        band: vis('landing-page-band'), bandTimes: vis('band-schedule-view'), host: vis('host-page'), gatheoLogin: vis('landing-page'),
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

  // 섹션이 아닌 경로·예전 해시 주소는 종전 그대로
  let o = await open('static', '/nope');
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
