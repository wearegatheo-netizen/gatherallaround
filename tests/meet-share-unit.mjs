// /meet/<id> 모임 공유 링크 함수 단위 테스트 — 크롤러 OG(대표 이미지)·사람용 셸 라우팅·폴백·잘못된 id
// 실행: node tests/meet-share-unit.mjs
import { onRequest, meetDateStr } from '../functions/meet/[id].js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk' };
const ID = '22222222-2222-4222-8222-222222222222';
const COVER = 'https://sb.test/storage/v1/object/public/community-images/meetings/c.jpg';
const MT = { title: '합주 <번개>', meeting_date: '2026-11-21', meeting_time: '17:00', location: '게더 올 어라운드', organizer_name: '길동', fee: 5000, cover_image_url: COVER, status: 'active' };
let calls;
const mock = (routes) => { calls = []; globalThis.fetch = async (url, opts = {}) => { const u = String(url); calls.push({ url: u, headers: opts.headers || {} }); for (const [pat, resp] of routes) if (u.includes(pat)) return new Response(JSON.stringify(resp.body), { status: resp.status ?? 200 }); throw new Error('unexpected ' + u); }; };
const SCRAP_UA = 'facebookexternalhit/1.1;kakaotalk-scrap/1.0;';
const INSTA_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0';
const ROOT = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ASSETS = { fetch: async (req) => new Response(new URL(req.url).pathname === '/' ? ROOT : '<html><head><title>other</title></head></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) };
const run = (path, id, { env = ENV, ua = '' } = {}) => onRequest({ request: new Request('https://gatherallaround.com' + path, ua ? { headers: { 'user-agent': ua } } : undefined), env, params: { id } });

chk('meetDateStr: "11/21(토) 17:00" · 시간 없음 · 잘못된 날짜', meetDateStr('2026-11-21', '17:00') === '11/21(토) 17:00' && meetDateStr('2026-11-21', '') === '11/21(토)' && meetDateStr('bad', '17:00') === '');

{ // 크롤러 → 대표 이미지 OG
  mock([['community_meetings?id=eq.' + ID, { body: [MT] }]]);
  const r = await run('/meet/' + ID, ID, { ua: SCRAP_UA }); const html = await r.text();
  chk('크롤러: 200 HTML·no-store', r.status === 200 && r.headers.get('content-type').includes('text/html') && r.headers.get('cache-control') === 'no-store');
  chk('OG title(이스케이프)·image=대표 이미지·url=/meet/<id>', html.includes('<meta property="og:title" content="합주 &lt;번개&gt;">') && html.includes(`<meta property="og:image" content="${COVER}">`) && html.includes(`<meta property="og:url" content="https://gatherallaround.com/meet/${ID}">`));
  chk('OG description: 일시·장소·모임장·참여비', html.includes('<meta property="og:description" content="11/21(토) 17:00 · 게더 올 어라운드 · 길동 · ₩5,000 — 커뮤니티 모임">'));
  chk('즉시 이동 → /#community/meeting/<id>', html.includes(`location.replace("/#community/meeting/${ID}")`) && html.includes(`content="0;url=/#community/meeting/${ID}"`));
  chk('service role 로 community_meetings 1건 조회', calls.length === 1 && calls[0].headers.apikey === 'sk' && calls[0].url.includes('limit=1'));
}
{ // 사람(인스타 인앱) → 루트 셸 + base + replaceState + OG
  mock([['community_meetings?id=eq.' + ID, { body: [MT] }]]);
  const r = await run('/meet/' + ID.toUpperCase(), ID.toUpperCase(), { env: { ...ENV, ASSETS }, ua: INSTA_UA }); const html = await r.text();
  chk('사람: 셸 200, 리다이렉트 없음', r.status === 200 && html.includes('id="portal-page"'));
  chk('<base href="/"> + replaceState(/#community/meeting/<소문자 id>) 가 <head> 머리에', html.includes('<head>\n    <base href="/">\n    <script>try{history.replaceState({page:\'community/meeting/' + ID + '\'},\'\',\'/#community/meeting/' + ID + '\')}catch(e){}</script>'));
  chk('셸에도 OG 주입·title 치환', html.includes(`<meta property="og:image" content="${COVER}">`) && html.includes('<title>합주 &lt;번개&gt; | 커뮤니티</title>'));
  chk('index.html 머리 스크립트가 /meet/<id> 정적 폴백도 해시로 치환', /\/meet\\\/\(\[0-9a-f-\]\{36\}\)/.test(ROOT) && ROOT.includes("'/#community/meeting/'"));
}
{ // pending·없음·env 없음·500·이미지 없음 → 기본 OG
  mock([['community_meetings?id=eq.' + ID, { body: [{ ...MT, status: 'pending' }] }]]);
  let html = await (await run('/meet/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('승인 대기 모임 → 기본 OG + 이동', !html.includes(COVER) && !html.includes('합주') && html.includes('커뮤니티 | Gather all around') && html.includes(`location.replace("/#community/meeting/${ID}")`));
  mock([['community_meetings', { body: [] }]]);
  html = await (await run('/meet/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('없는 모임 → 기본 OG', html.includes('커뮤니티 | Gather all around'));
  mock([]);
  html = await (await run('/meet/' + ID, ID, { env: {}, ua: SCRAP_UA })).text();
  chk('env 없음 → 조회 없이 기본 OG', calls.length === 0 && html.includes('커뮤니티 | Gather all around'));
  mock([['community_meetings', { status: 500, body: {} }]]);
  html = await (await run('/meet/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('DB 500 → 기본 OG + 이동', html.includes(`location.replace("/#community/meeting/${ID}")`));
  mock([['community_meetings?id=eq.' + ID, { body: [{ ...MT, cover_image_url: null, fee: 0, status: null }] }]]);
  html = await (await run('/meet/' + ID, ID, { ua: SCRAP_UA })).text();
  chk('이미지 없음 → 기본 이미지(1200×630), 무료, status null 은 active 취급', html.includes('og:image" content="https://gatherallaround.com/icon.jpg"') && html.includes('og:image:width" content="1200"') && html.includes('· 무료 — 커뮤니티 모임'));
}
{ // 셸을 못 읽는 사람 → 302; 잘못된 id → 302 /#community
  mock([['community_meetings', { body: [MT] }]]);
  let r = await run('/meet/' + ID, ID, { ua: INSTA_UA });
  chk('ASSETS 없음 → 302 /#community/meeting/<id>', r.status === 302 && r.headers.get('location') === `https://gatherallaround.com/#community/meeting/${ID}`);
  mock([]);
  r = await run('/meet/not-a-uuid', 'not-a-uuid', { ua: SCRAP_UA });
  chk('잘못된 id → 302 /#community, 조회 없음', r.status === 302 && r.headers.get('location') === 'https://gatherallaround.com/#community' && calls.length === 0);
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
