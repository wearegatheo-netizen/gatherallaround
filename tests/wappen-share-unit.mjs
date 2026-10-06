// /wp/<id> · /ww/<id> 공유 링크 함수 단위 테스트 — OG 태그·즉시 이동·잘못된 id 처리
// 실행: node tests/wappen-share-unit.mjs
import { onRequest as wp } from '../functions/wp/[id].js';
import { onRequest as ww } from '../functions/ww/[id].js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk' };
const PID = '33333333-3333-4333-8333-333333333333', WID = '44444444-4444-4444-8444-444444444444';
let calls;
const mock = (routes) => { calls = []; globalThis.fetch = async (url, opts = {}) => { const u = String(url); calls.push({ url: u, headers: opts.headers || {} }); for (const [pat, resp] of routes) if (u.includes(pat)) return new Response(JSON.stringify(resp.body), { status: resp.status ?? 200 }); throw new Error('unexpected ' + u); }; };
const KAKAO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.5';
const SCRAP_UA = 'facebookexternalhit/1.1;kakaotalk-scrap/1.0;';
const run = (fn, path, id, env = ENV, ua = '') => fn({ request: new Request('https://gatherallaround.com' + path, ua ? { headers: { 'user-agent': ua } } : undefined), env, params: { id } });

{ // 프로젝트
  mock([['wappen_projects?id=eq.' + PID, { body: [{ title: 'A4 <포스터>', author_name: '길동', description: null, thumb_url: 'https://sb.test/t.jpg', base_image_url: 'https://sb.test/b.jpg', works_count: 2 }] }]]);
  const r = await run(wp, '/wp/' + PID, PID); const html = await r.text();
  chk('200 HTML·no-store', r.status === 200 && r.headers.get('content-type').includes('text/html') && r.headers.get('cache-control') === 'no-store');
  chk('OG: title(이스케이프)·image(썸네일)·url(/wp/)', html.includes('<meta property="og:title" content="A4 &lt;포스터&gt; — 와펜 꾸미기 프로젝트">') && html.includes('<meta property="og:image" content="https://sb.test/t.jpg">') && html.includes(`<meta property="og:url" content="https://gatherallaround.com/wp/${PID}">`));
  chk('즉시 이동: script location.replace + meta refresh + 링크', html.includes(`location.replace("/wappen/#/project/${PID}")`) && html.includes(`content="0;url=/wappen/#/project/${PID}"`) && html.includes(`href="/wappen/#/project/${PID}"`));
  chk('service role 로 active 행 1건 조회', calls.length === 1 && calls[0].headers.apikey === 'sk' && calls[0].url.includes('status=eq.active'));
}
{ // 작품 + 대문자 id
  mock([['wappen_works?id=eq.' + WID, { body: [{ title: '첫 작품', author_name: '길동', preview_url: 'https://sb.test/p.jpg', preview_w: 1080, preview_h: 1350, wappen_projects: { title: '프로젝', status: 'active' } }] }]]);
  const html = await (await run(ww, '/ww/' + WID.toUpperCase(), WID.toUpperCase())).text();
  chk('작품 OG·크기·소문자 id 로 이동', html.includes('<meta property="og:title" content="첫 작품 — 길동님의 와펜 작품">') && html.includes('<meta property="og:image:width" content="1080">') && html.includes(`location.replace("/wappen/#/work/${WID}")`));
}
{ // 없는 행·env 없음 → 기본 OG 지만 이동은 그대로
  mock([['wappen_works', { body: [] }]]);
  const html = await (await run(ww, '/ww/' + WID, WID)).text();
  chk('숨김/없는 작품 → 기본 OG + 이동', html.includes('와펜 꾸미기 | Gather all around') && html.includes(`location.replace("/wappen/#/work/${WID}")`));
  mock([]);
  const html2 = await (await run(wp, '/wp/' + PID, PID, {})).text();
  chk('env 없음 → 조회 없이 기본 OG + 이동', calls.length === 0 && html2.includes(`location.replace("/wappen/#/project/${PID}")`));
  mock([['wappen_projects', { status: 500, body: {} }]]);
  chk('DB 500 → 기본 OG + 이동', (await (await run(wp, '/wp/' + PID, PID)).text()).includes(`location.replace("/wappen/#/project/${PID}")`));
}
{ // 잘못된 id → /wappen/ 로 302
  mock([]);
  const r = await run(wp, '/wp/abc', 'abc');
  chk('잘못된 id → 302 /wappen/', r.status === 302 && r.headers.get('location') === 'https://gatherallaround.com/wappen/' && calls.length === 0);
}
{ // 사람(브라우저 UA) → DB 조회 없이 HTTP 302 로 앱 해시 라우트 (카톡 인앱 포함) / 크롤러 UA → OG HTML
  mock([]);
  const r = await run(wp, '/wp/' + PID, PID, ENV, KAKAO_UA);
  chk('카톡 인앱 브라우저 UA → 302 /wappen/#/project/<id>, 조회 없음', r.status === 302 && r.headers.get('location') === `https://gatherallaround.com/wappen/#/project/${PID}` && r.headers.get('cache-control') === 'no-store' && calls.length === 0);
  const r2 = await run(ww, '/ww/' + WID.toUpperCase(), WID.toUpperCase(), ENV, 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36');
  chk('안드로이드 크롬 UA → 302 /wappen/#/work/<소문자 id>', r2.status === 302 && r2.headers.get('location') === `https://gatherallaround.com/wappen/#/work/${WID}`);
  mock([['wappen_works?id=eq.' + WID, { body: [{ title: '첫 작품', author_name: '길동', preview_url: 'https://sb.test/p.jpg', preview_w: 1080, preview_h: 1350, wappen_projects: { title: '프로� ', status: 'active' } }] }]]);
  const r3 = await run(ww, '/ww/' + WID, WID, ENV, SCRAP_UA);
  chk('카카오톡 스크랩 크롤러 UA → 200 OG HTML', r3.status === 200 && (await r3.text()).includes('<meta property="og:image" content="https://sb.test/p.jpg">') && calls.length === 1);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
