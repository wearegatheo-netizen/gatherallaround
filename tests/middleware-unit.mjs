// functions/_middleware.js 단위 테스트 — ?news= 회귀 + 와펜 공유 쿼리형(/?wp=|?ww=, 예전 /wappen/?p=|?w=): 사람 UA 302 · 크롤러 OG 주입
// 실행: node tests/middleware-unit.mjs
import { onRequest } from '../functions/_middleware.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk' };
const WID = '44444444-4444-4444-8444-444444444444', PID = '33333333-3333-4333-8333-333333333333';
const PAGE = readFileSync(new URL('../wappen/index.html', import.meta.url), 'utf8');
// 루트 index.html 과 같은 메타 형식의 축약 샘플 (og:image:width/height 포함)
const ROOT = '<title>Gather all around | Premium Studio</title><meta property="og:type" content="website"><meta property="og:title" content="Gather all around | Premium Studio"><meta property="og:description" content="게더 올 어라운드"><meta property="og:image" content="https://x/icon.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="https://gatherallaround.com"><meta name="twitter:image" content="https://x/icon.jpg"><body>portal</body>';

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { url: String(url), headers: opts.headers || {} }; calls.push(rec);
    for (const [pat, resp] of routes) if (rec.url.includes(pat)) return new Response(JSON.stringify(typeof resp.body === 'function' ? resp.body(rec) : resp.body), { status: resp.status ?? 200 });
    throw new Error('unexpected fetch ' + rec.url);
  };
}
const run = (path, { html = PAGE, ct = 'text/html; charset=utf-8', env = ENV, ua = '' } = {}) => onRequest({
  request: new Request('https://gatherallaround.com' + path, ua ? { headers: { 'user-agent': ua } } : undefined), env,
  next: async () => new Response(html, { status: 200, headers: { 'content-type': ct, 'x-keep': '1' } }),
});
const WORK = { title: '첫 작품', author_name: '길동', preview_url: 'https://sb.test/storage/v1/object/public/wappen/previews/u/x.jpg', preview_w: 1080, preview_h: 1350, wappen_projects: { title: '여름 <포스터>', status: 'active' } };

{ // 무관한 요청은 그대로
  mockFetch([]);
  const r = await run('/wappen/#/');
  chk('일반 요청: 원본 응답 통과 (fetch 없음)', (await r.text()) === PAGE && calls.length === 0 && r.headers.get('x-keep') === '1');
  const r2 = await run('/other?w=' + WID);
  chk('다른 경로의 ?w= 는 무시', (await r2.text()) === PAGE && calls.length === 0);
}
{ // ?w= 작품
  mockFetch([['wappen_works?id=eq.' + WID, { body: [WORK] }]]);
  const r = await run(`/wappen/?w=${WID}`);
  const html = await r.text();
  chk('작품 OG: title 치환', html.includes('<title>첫 작품 — 길동님의 와펜 작품 | 포스터 꾸미기</title>'));
  chk('작품 OG: og:title·description(프로젝트명 이스케이프)', html.includes('<meta property="og:title" content="첫 작품 — 길동님의 와펜 작품">') && html.includes('여름 &lt;포스터&gt; 프로젝트 · '));
  chk('작품 OG: og:image·크기·url(표준 루트 형태)', html.includes(`<meta property="og:image" content="${WORK.preview_url}">`) && html.includes('<meta property="og:image:width" content="1080">') && html.includes('<meta property="og:image:height" content="1350">') && html.includes(`<meta property="og:url" content="https://gatherallaround.com/ww/${WID}">`));
  chk('작품 OG: twitter:image 치환·no-store', html.includes(`<meta name="twitter:image" content="${WORK.preview_url}">`) && r.headers.get('cache-control') === 'no-store');
  chk('작품 OG: service role 헤더·active 필터·1행', calls.length === 1 && calls[0].headers.apikey === 'sk' && calls[0].url.includes('status=eq.active') && calls[0].url.includes('limit=1'));
  chk('본문의 나머지는 보존', html.includes('<script type="module" src="./app.js'));
}
{ // ?p= 프로젝트 (썸네일 없으면 기본 이미지, 크기 태그 제거)
  mockFetch([['wappen_projects?id=eq.' + PID, { body: [{ title: 'A4 포스터', author_name: '길동', description: null, thumb_url: null, base_image_url: 'https://sb.test/b.jpg', works_count: 3 }] }]]);
  const html = await (await run(`/wappen/?p=${PID}`)).text();
  chk('프로젝트 OG: title·설명 기본 문구', html.includes('<meta property="og:title" content="A4 포스터 — 포스터 꾸미기 프로젝트">') && html.includes('작품 3개'));
  chk('프로젝트 OG: 이미지 폴백·og:image:width 제거', html.includes('<meta property="og:image" content="https://sb.test/b.jpg">') && !html.includes('og:image:width'));
}
{ // 루트 ?wp= / ?ww= (카카오톡 공유 표준 형태) — 루트 index.html 메타에 주입
  mockFetch([['wappen_projects?id=eq.' + PID, { body: [{ title: 'A4 포스터', author_name: '길동', description: '설명', thumb_url: 'https://sb.test/t.jpg', base_image_url: 'https://sb.test/b.jpg', works_count: 1 }] }]]);
  const html = await (await run(`/?wp=${PID}`, { html: ROOT })).text();
  chk('루트 ?wp=: title·og:title·og:image(썸네일)·og:url', html.includes('<title>A4 포스터 — 포스터 꾸미기 프로젝트 | 포스터 꾸미기</title>') && html.includes('<meta property="og:title" content="A4 포스터 — 포스터 꾸미기 프로젝트">')
    && html.includes('<meta property="og:image" content="https://sb.test/t.jpg">') && html.includes(`<meta property="og:url" content="https://gatherallaround.com/wp/${PID}">`) && html.includes('<body>portal</body>'));
  chk('루트 ?wp=: service role 조회 1회·active 필터', calls.length === 1 && calls[0].url.includes('wappen_projects?id=eq.') && calls[0].url.includes('status=eq.active'));
  mockFetch([['wappen_works?id=eq.' + WID, { body: [WORK] }]]);
  const html2 = await (await run(`/index.html?ww=${WID.toUpperCase()}`, { html: ROOT })).text();
  chk('루트 /index.html?ww=(대문자 uuid): 작품 OG·소문자 id·크기', html2.includes('<meta property="og:title" content="첫 작품 — 길동님의 와펜 작품">') && html2.includes(`/ww/${WID}">`) && html2.includes('<meta property="og:image:width" content="1080">'));
  mockFetch([]);
  chk('루트의 예전 ?p= 는 미들웨어가 건드리지 않음(페이지 스크립트가 리다이렉트)', (await (await run(`/?p=${PID}`, { html: ROOT })).text()) === ROOT && calls.length === 0);
  chk('루트 ?wp= 잘못된 uuid → 원본', (await (await run('/?wp=abc', { html: ROOT })).text()) === ROOT && calls.length === 0);
  mockFetch([['googleapis.com/drive/v3/files/abc', { body: { name: 'N.html' } }]]);
  const html3 = await (await run(`/?news=abc&wp=${PID}`, { html: ROOT })).text();
  chk('?news= 가 함께 오면 뉴스 분기 우선', html3.includes('<title>N | 어제 하루, 밴드씬에서 생긴 일?!</title>') && !calls.some(c => c.url.includes('wappen_')));
}
{ // 실패·예외는 원본 그대로
  // 사람(브라우저 UA)은 next() 도 조회도 없이 302 → 앱 해시 라우트 (크롤러·UA 없음은 위처럼 OG 주입)
  const KAKAO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.5';
  mockFetch([]);
  const r302 = await run(`/?wp=${PID}`, { ua: KAKAO_UA });
  chk('루트 /?wp= + 카톡 인앱 UA → 302 경로형 /wp/<id>(해시 없음), 조회 없음', r302.status === 302 && r302.headers.get('location') === `https://gatherallaround.com/wp/${PID}` && calls.length === 0);
  const r302b = await run(`/wappen/?w=${WID.toUpperCase()}`, { ua: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });
  chk('예전 /wappen/?w=(대문자) + 사파리 UA → 302 /ww/<소문자>', r302b.status === 302 && r302b.headers.get('location') === `https://gatherallaround.com/ww/${WID}`);
  chk('/wappen/?w=잘못된 uuid + 사람 UA → 302 아님(원본)', (await run('/wappen/?w=nope', { ua: KAKAO_UA })).status === 200);
  mockFetch([['wappen_works?id=eq.' + WID, { body: [WORK] }]]);
  chk('카카오톡 스크랩 크롤러 UA → OG 주입', (await (await run(`/?ww=${WID}`, { ua: 'facebookexternalhit/1.1;kakaotalk-scrap/1.0;' })).text()).includes('<meta property="og:title" content="첫 작품 — 길동님의 와펜 작품">'));
  mockFetch([['wappen_works', { body: [] }]]);
  chk('숨김/없는 작품 → 원본', (await (await run(`/wappen/?w=${WID}`)).text()) === PAGE);
  mockFetch([]);
  chk('잘못된 uuid → 원본, 조회 없음', (await (await run('/wappen/?w=not-a-uuid')).text()) === PAGE && calls.length === 0);
  chk('env 없음 → 원본', (await (await run(`/wappen/?w=${WID}`, { env: {} })).text()) === PAGE);
  chk('HTML 아님 → 원본', (await (await run(`/wappen/?w=${WID}`, { html: '{}', ct: 'application/json' })).text()) === '{}');
  mockFetch([['wappen_works', { status: 500, body: { message: 'boom' } }]]);
  chk('DB 500 → 원본', (await (await run(`/wappen/?w=${WID}`)).text()) === PAGE);
}
{ // ?news= 회귀
  mockFetch([['googleapis.com/drive/v3/files/abc', { body: { name: '오늘의 뉴스.html' } }]]);
  const html = await (await run('/?news=abc', { html: '<title>x</title><meta property="og:title" content="a"><meta property="og:description" content="b">' })).text();
  chk('news: Drive 제목으로 title·og 치환', html.includes('<title>오늘의 뉴스 | 어제 하루, 밴드씬에서 생긴 일?!</title>') && html.includes('content="국내외 밴드씬 이슈를 한 번에 읽어보자"'));
}
{ // 경로형 섹션 주소(2026-11-05): /perf = /#perf … 셸 200 + replaceState 해시 라우트
  const { appRouteFromPath } = await import('../functions/_middleware.js');
  const SHELL = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  let assetCalls = [];
  const ASSETS = { fetch: async (req) => { assetCalls.push(new URL(req.url).pathname); return new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }); } };
  const ENV_A = { ...ENV, ASSETS };
  const runA = (p, o = {}) => { assetCalls = []; return run(p, { env: ENV_A, ...o }); };
  const routeOf = (html) => (/history\.replaceState\(null,'','\/'\+location\.search\+'#([^']*)'\)/.exec(html) || [])[1];
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

  chk('appRouteFromPath: 섹션·하위 경로', appRouteFromPath('/perf') === 'perf' && appRouteFromPath('/perf/') === 'perf' && appRouteFromPath('/Perf') === 'perf'
    && appRouteFromPath('/band/times') === 'band/times' && appRouteFromPath('/gatheo/member/schedule') === 'gatheo/member/schedule' && appRouteFromPath('/band-news') === 'band-news');
  chk('appRouteFromPath: 섹션 아님 → null', [ '/', '/index.html', '/wappen/', '/show/x', '/meet/x', '/bandx', '/performance', '/sw.js', '/img/portal/a.webp' ].every(p => appRouteFromPath(p) === null));
  chk('appRouteFromPath: 위험 글자·너무 깊음 → 섹션까지', appRouteFromPath("/perf/'-alert(1)-'") === 'perf' && appRouteFromPath('/shows/a%3Cb') === 'shows' && appRouteFromPath('/gatheo/a/b/c/d') === 'gatheo');

  mockFetch([]);
  let r = await runA('/perf', { ua: SAFARI });
  let html = await r.text();
  chk('/perf → 200 셸(ASSETS /) + #perf 라우트(base 없음 — 쿼리 유지)', r.status === 200 && assetCalls.join() === '/' && routeOf(html) === 'perf' && !html.includes('<base ') && r.headers.get('cache-control') === 'no-store');
  chk('/perf: 공간 대관 OG(title·url), 이미지는 기본', html.includes('<meta property="og:title" content="공간 대관 | Gather all around">') && html.includes('<meta property="og:url" content="https://gatherallaround.com/perf">') && html.includes('og:image:width'));
  chk('/perf: 셸 머리 스크립트보다 라우트 치환이 먼저', html.indexOf("'#perf'") < html.indexOf('URLSearchParams(location.search)'));
  html = await (await runA('/band/guide')).text();
  chk('/band/guide → #band/guide + 운영 안내 OG', routeOf(html) === 'band/guide' && html.includes('고정 합주팀 운영 안내'), routeOf(html));
  html = await (await runA('/band/times')).text();
  chk('/band/times → #band/times + 고정 합주팀 가능 시간 OG', routeOf(html) === 'band/times' && html.includes('고정 합주팀 가능 시간 | Gather all around'));
  html = await (await runA('/gatheo/board/11111111-1111-4111-8111-111111111111')).text();
  chk('/gatheo/board/<id> → 같은 해시 라우트', routeOf(html) === 'gatheo/board/11111111-1111-4111-8111-111111111111');
  html = await (await runA('/shows/ticket/ABC234')).text();
  chk('/shows/ticket/<코드> → 일반 셸(코드 그대로, 대문자화는 라우터)', routeOf(html) === 'shows/ticket/ABC234' && html.includes('공연 예매 | Gather all around'));
  html = await (await runA("/perf/'-x-'")).text();
  chk("위험 글자 경로 → #perf 로 절단(스크립트에 안 들어감)", routeOf(html) === 'perf' && !html.includes("'-x-'"));
  html = await (await runA('/host', { ua: SAFARI })).text();
  chk('/host → #host + 호스트 센터 OG', routeOf(html) === 'host' && html.includes('호스트 센터 | Gather all around'));
  chk('HEAD/GET 외 요청은 통과(POST)', (await (await onRequest({ request: new Request('https://gatherallaround.com/perf', { method: 'POST' }), env: ENV_A, next: async () => new Response('next') })).text()) === 'next');
  chk('ASSETS 없으면 next()(정적 SPA 폴백)', (await (await run('/perf', { env: ENV })).text()) === PAGE);

  // 공연·모임 상세는 공유 함수와 같은 응답(포스터 OG)
  const EID = '55555555-5555-4555-8555-555555555555', MID = '66666666-6666-4666-8666-666666666666';
  mockFetch([['events?id=eq.' + EID, { body: [{ title: '가을 공연', starts_at: '2026-11-21T08:00:00Z', venue: '게더', host_name: '밴드', poster_url: 'https://sb.test/p.jpg', status: 'published', price: 10000 }] }]]);
  html = await (await runA('/shows/' + EID.toUpperCase(), { ua: 'facebookexternalhit/1.1;kakaotalk-scrap/1.0;' })).text();
  chk('/shows/<uuid> 크롤러 → 공연 포스터 OG(/show/<id> 와 같음)', html.includes('<meta property="og:title" content="가을 공연">') && html.includes('https://sb.test/p.jpg') && html.includes(`/show/${EID}`));
  html = await (await runA('/shows/' + EID, { ua: SAFARI })).text();
  chk('/shows/<uuid> 사람 → 셸 + #shows/<id>', html.includes(`/#shows/${EID}`) && html.includes('<meta property="og:title" content="가을 공연">'));
  mockFetch([['community_meetings?id=eq.' + MID, { body: [{ title: '보드게임 모임', meeting_date: '2026-11-21', meeting_time: '17:00', location: '게더', fee: 0, cover_image_url: 'https://sb.test/c.jpg', organizer_name: '보라', status: 'active' }] }]]);
  html = await (await runA('/community/meeting/' + MID, { ua: 'facebookexternalhit/1.1;kakaotalk-scrap/1.0;' })).text();
  chk('/community/meeting/<uuid> 크롤러 → 모임 OG(/meet/<id> 와 같음)', html.includes('보드게임 모임') && html.includes('https://sb.test/c.jpg'));
  mockFetch([]);
  html = await (await runA('/community/test')).text();
  chk('/community/test → #community/test + 커뮤니티 OG', routeOf(html) === 'community/test' && html.includes('커뮤니티 | Gather all around'));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
