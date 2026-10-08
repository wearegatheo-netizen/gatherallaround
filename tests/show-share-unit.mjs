// /show/<id> 공연 공유 링크 함수 단위 테스트 — 크롤러 OG(포스터)·사람용 셸 라우팅·폴백·잘못된 id
// 실행: node tests/show-share-unit.mjs
import { onRequest, showDateStr } from '../functions/show/[id].js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk' };
const ID = '11111111-1111-4111-8111-111111111111';
const POSTER = 'https://sb.test/storage/v1/object/public/community-images/events/p.jpg';
const EV = { title: '한여름 밤의 <락>', starts_at: '2026-10-18T10:00:00Z', venue: '게더 올 어라운드', host_name: '밴드 스컬', poster_url: POSTER, status: 'published', price: 15000 };
let calls;
const mock = (routes) => { calls = []; globalThis.fetch = async (url, opts = {}) => { const u = String(url); calls.push({ url: u, headers: opts.headers || {} }); for (const [pat, resp] of routes) if (u.includes(pat)) return new Response(JSON.stringify(resp.body), { status: resp.status ?? 200 }); throw new Error('unexpected ' + u); }; };
const SCRAP_UA = 'facebookexternalhit/1.1;kakaotalk-scrap/1.0;';
const KAKAO_INAPP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.5';
const ROOT = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ASSETS = { fetch: async (req) => new Response(new URL(req.url).pathname === '/' ? ROOT : '<html><head><title>other</title></head></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) };
const run = (path, id, { env = ENV, ua = '' } = {}) => onRequest({ request: new Request('https://gatherallaround.com' + path, ua ? { headers: { 'user-agent': ua } } : undefined), env, params: { id } });

chk('showDateStr: UTC → KST 표기 "10/18(일) 19:00"', showDateStr('2026-10-18T10:00:00Z') === '10/18(일) 19:00' && showDateStr('bad') === '');

{ // 크롤러 → 포스터 OG
  mock([['events?id=eq.' + ID, { body: [EV] }]]);
  const r = await run('/show/' + ID, ID, { ua: SCRAP_UA }); const html = await r.text();
  chk('크롤러: 200 HTML·no-store', r.status === 200 && r.headers.get('content-type').includes('text/html') && r.headers.get('cache-control') === 'no-store');
  chk('OG title(이스케이프)·image=포스터·url=/show/<id>', html.includes('<meta property="og:title" content="한여름 밤의 &lt;락&gt;">') && html.includes(`<meta property="og:image" content="${POSTER}">`) && html.includes(`<meta property="og:url" content="https://gatherallaround.com/show/${ID}">`) && html.includes(`<meta name="twitter:image" content="${POSTER}">`));
  chk('OG description: 일시(KST)·장소·주최·가격', html.includes('<meta property="og:description" content="10/18(일) 19:00 · 게더 올 어라운드 · 밴드 스컬 · ₩15,000 — 공연 예매">'));
  chk('포스터는 크기 미상 → og:image:width/height 없음', !/og:image:(width|height)/.test(html));
  chk('즉시 이동: location.replace + meta refresh + 링크 → /#shows/<id>', html.includes(`location.replace("/#shows/${ID}")`) && html.includes(`content="0;url=/#shows/${ID}"`) && html.includes(`href="/#shows/${ID}"`));
  chk('service role 로 events 1건 조회', calls.length === 1 && calls[0].headers.apikey === 'sk' && calls[0].url.includes('events?id=eq.' + ID) && calls[0].url.includes('limit=1'));
}
{ // 사람(카톡 인앱 포함) → 루트 셸 + base + replaceState + OG
  mock([['events?id=eq.' + ID, { body: [EV] }]]);
  const r = await run('/show/' + ID.toUpperCase(), ID.toUpperCase(), { env: { ...ENV, ASSETS }, ua: KAKAO_INAPP_UA }); const html = await r.text();
  chk('사람: 셸 200, 리다이렉트 없음', r.status === 200 && html.includes('id="portal-page"'));
  chk('<base href="/"> + history.replaceState(/#shows/<소문자 id>) 가 <head> 머리에', html.includes('<head>\n    <base href="/">\n    <script>try{history.replaceState({page:\'shows/' + ID + '\'},\'\',\'/#shows/' + ID + '\')}catch(e){}</script>'));
  chk('셸에도 포스터 OG 주입(인앱 공유 재스크랩 대비)·title 치환', html.includes(`<meta property="og:image" content="${POSTER}">`) && html.includes('<title>한여름 밤의 &lt;락&gt; | 공연 예매</title>') && !/og:image:(width|height)/.test(html));
  chk('셸의 상대 경로 자산 없음(base 와 무관하게 안전)', !/(src|href)="vendor\//.test(html));
}
{ // 숨김·없는 공연·env 없음·DB 오류 → 기본 OG(기본 이미지 1200×630) + 이동
  mock([['events?id=eq.' + ID, { body: [{ ...EV, status: 'hidden' }] }]]);
  let html = await (await run('/show/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('숨김 공연 → 기본 OG(포스터·제목 노출 안 함) + 이동', !html.includes(POSTER) && !html.includes('한여름') && html.includes('공연 예매 | Gather all around') && html.includes('og:image:width" content="1200"') && html.includes(`location.replace("/#shows/${ID}")`));
  mock([['events', { body: [] }]]);
  html = await (await run('/show/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('없는 공연 → 기본 OG + 이동', html.includes('공연 예매 | Gather all around') && html.includes(`location.replace("/#shows/${ID}")`));
  mock([]);
  html = await (await run('/show/' + ID, ID, { env: {}, ua: SCRAP_UA })).text();
  chk('env 없음 → 조회 없이 기본 OG', calls.length === 0 && html.includes('공연 예매 | Gather all around'));
  mock([['events', { status: 500, body: {} }]]);
  html = await (await run('/show/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('DB 500 → 기본 OG + 이동', html.includes(`location.replace("/#shows/${ID}")`));
  mock([['events?id=eq.' + ID, { body: [{ ...EV, poster_url: null, price: 0 }] }]]);
  html = await (await run('/show/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('포스터 없음 → 기본 이미지(1200×630 유지), 무료 표기', html.includes('og:image" content="https://gatherallaround.com/icon.jpg"') && html.includes('og:image:width" content="1200"') && html.includes('· 무료 — 공연 예매'));
}
{ // 셸을 못 읽는 사람 → 302 /#shows/<id>; 잘못된 id → 302 /#shows
  mock([['events', { body: [EV] }]]);
  let r = await run('/show/' + ID, ID, { ua: KAKAO_INAPP_UA });
  chk('ASSETS 없음 → 302 /#shows/<id>', r.status === 302 && r.headers.get('location') === `https://gatherallaround.com/#shows/${ID}`);
  r = await run('/show/' + ID, ID, { env: { ...ENV, ASSETS: { fetch: async () => new Response('<html><head><title>other</title></head></html>', { status: 200 }) } }, ua: KAKAO_INAPP_UA });
  chk('포털 셸이 아닌 응답이면 302 폴백', r.status === 302);
  mock([]);
  r = await run('/show/not-a-uuid', 'not-a-uuid', { ua: SCRAP_UA });
  chk('잘못된 id → 302 /#shows, 조회 없음', r.status === 302 && r.headers.get('location') === 'https://gatherallaround.com/#shows' && calls.length === 0);
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
