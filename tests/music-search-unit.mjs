// /music-search Cloudflare 함수 단위 테스트 — fetch 목으로 Deezer 프록시 검증
// (애플 KR 뮤직비디오 검색·두 결과 합치기는 브라우저 쪽 index.html musicSearch() — Playwright UI 테스트에서 검증)
// 실행: node tests/music-search-unit.mjs
import { onRequest } from '../functions/music-search.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const req = (qs, headers = { 'Sec-Fetch-Site': 'same-origin' }, method = 'GET') =>
  new Request('https://gatherallaround.com/music-search' + (qs ? '?' + qs : ''), { method, headers });
const run = (qs, headers) => onRequest({ request: req(qs, headers), env: {} });

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {} };
    calls.push(rec);
    for (const [pat, resp] of routes) {
      if (rec.url.includes(pat)) {
        const r = typeof resp === 'function' ? resp(rec) : resp;
        const body = typeof r.text === 'string' ? r.text : JSON.stringify(r.body ?? {});
        return new Response(body, { status: r.status ?? 200, headers: { 'Content-Type': r.text != null ? 'text/html' : 'application/json' } });
      }
    }
    throw new Error('unexpected fetch: ' + rec.method + ' ' + rec.url);
  };
}

const DZ_TRACKS = { body: { data: [
  { id: 1, title: 'For Lovers Who Hesitate', artist: { name: 'JANNABI' }, album: { cover_small: 'https://d/s56.jpg', cover_medium: 'https://d/m250.jpg', cover_big: 'https://d/b500.jpg' } },
  { id: 2, title: '주저하는 연인들을 위해', artist: { name: '잔나비' }, album: { cover_small: 'https://d/s2.jpg' } },
  { id: 3, title: 'Dreams, Books, Power and Walls', artist: { name: 'JANNABI' } },
], total: 3 } };
const DZ_ARTISTS = { body: { data: [
  { id: 10, name: 'JANNABI', picture_small: 'https://d/a56.jpg', picture_medium: 'https://d/a250.jpg' },
  { id: 11, name: '잔나비' },
], total: 2 } };

// ── 1. 메서드·게이트
{
  mockFetch([]);
  let r = await onRequest({ request: req('q=x', {}, 'OPTIONS'), env: {} });
  chk('OPTIONS → CORS 헤더', r.headers.get('Access-Control-Allow-Origin') === 'https://gatherallaround.com');
  r = await onRequest({ request: req('q=x', {}, 'POST'), env: {} });
  chk('POST → 405', r.status === 405);
  r = await run('q=잔나비', {});
  chk('출처 헤더 없는 검색 → 403, 외부 호출 없음', r.status === 403 && calls.length === 0);
  mockFetch([['api.deezer.com/search/track', DZ_TRACKS]]);
  r = await run('q=잔나비', { Referer: 'https://www.gatherallaround.com/' });
  chk('Referer 가 우리 도메인이면 통과', r.status === 200);
  r = await run('q=잔나비', { Origin: 'https://gatherallaround.pages.dev' });
  chk('Origin 이 pages.dev 미리보기여도 통과', r.status === 200);
  r = await run('q=잔나비', { Referer: 'https://evil.example/' });
  chk('남의 사이트 Referer → 403', r.status === 403);
}

// ── 2. 곡 검색 — 요청 형식·결과 매핑
{
  mockFetch([['api.deezer.com/search/track', DZ_TRACKS]]);
  const r = await run('q=잔나비&type=song&limit=8');
  const j = await r.json();
  chk('곡 3건, source=deezer, sources.deezer=3', r.status === 200 && j.ok && j.results.length === 3 && j.results.every(x => x.source === 'deezer') && j.sources.deezer === 3);
  chk('결과 매핑: title/artist.name/앨범 cover_medium 우선, 없으면 small, 둘 다 없으면 빈 문자열',
    j.results[0].title === 'For Lovers Who Hesitate' && j.results[0].artist === 'JANNABI' && j.results[0].artwork === 'https://d/m250.jpg' && j.results[1].artwork === 'https://d/s2.jpg' && j.results[2].artwork === '');
  const u = calls.find(c => c.url.includes('deezer')).url;
  chk('Deezer 호출: /search/track, q 인코딩, limit=8, 키 없음', u.startsWith('https://api.deezer.com/search/track?') && u.includes('q=%EC%9E%94%EB%82%98%EB%B9%84') && u.includes('limit=8') && !/access_token|api_key/.test(u));
  chk('성공 응답은 1일 캐시 헤더', (r.headers.get('Cache-Control') || '').includes('max-age=86400'));
}

// ── 3. 가수 검색
{
  mockFetch([['api.deezer.com/search/artist', DZ_ARTISTS]]);
  const r = await run('q=잔나비&type=artist&limit=6');
  const j = await r.json();
  chk('가수: /search/artist, name/image(picture_medium)/source', j.type === 'artist' && j.results.length === 2 && j.results[0].name === 'JANNABI' && j.results[0].image === 'https://d/a250.jpg' && j.results[1].image === '' && calls[0].url.includes('/search/artist?'));
}

// ── 4. 실패 — 500 JSON (502 는 Cloudflare 가 본문을 가림), 캐시 안 함
{
  mockFetch([['api.deezer.com', { status: 503, text: '<html>Service Unavailable</html>' }]]);
  let r = await run('q=잔나비');
  let j = await r.json();
  chk('HTTP 503 → 500 upstream + 상태·본문 일부, no-store', r.status === 500 && j.ok === false && j.error === 'upstream' && j.errors.deezer.startsWith('deezer 503') && r.headers.get('Cache-Control') === 'no-store');
  mockFetch([['api.deezer.com', { body: { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } } }]]);
  r = await run('q=잔나비');
  j = await r.json();
  chk('HTTP 200 이지만 본문 error(쿼터 code 4) → 500 upstream "deezer code 4: Quota limit exceeded"', r.status === 500 && j.errors.deezer === 'deezer code 4: Quota limit exceeded');
  mockFetch([['api.deezer.com', { body: { error: { type: 'DataException', message: 'no data', code: 800 } } }]]);
  r = await run('q=잔나비');
  j = await r.json();
  chk('본문 error code 800(no data) → 결과 없음으로 200', r.status === 200 && j.ok && j.results.length === 0 && j.sources.deezer === 0);
  mockFetch([['api.deezer.com', { text: '<html>blocked</html>' }]]);
  r = await run('q=잔나비');
  j = await r.json();
  chk('JSON 아닌 200 본문 → 500 "deezer bad response"', r.status === 500 && j.errors.deezer.startsWith('deezer bad response'));
  mockFetch([]);
  globalThis.fetch = () => { throw new TypeError('boom'); };
  r = await run('q=x');
  chk('외부 호출이 동기 예외를 던져도 500 upstream JSON', r.status === 500 && (await r.json()).errors.deezer === 'boom');
  globalThis.caches = { get default() { throw new Error('cache broken'); } }; // 런타임 객체 자체가 깨진 경우
  r = await run('q=x');
  delete globalThis.caches;
  chk('예기치 못한 예외 → JSON 500 internal (Cloudflare 기본 오류문 아님)', r.status === 500 && (await r.json()).error === 'internal');
}

// ── 5. 입력 정리·진단
{
  mockFetch([['api.deezer.com/search/track', DZ_TRACKS]]);
  const long = 'ㄱ'.repeat(80);
  let r = await run('q=' + encodeURIComponent('  ' + long + '  ') + '&limit=50&type=weird');
  let j = await r.json();
  const u = calls.find(c => c.url.includes('deezer')).url;
  chk('q 60자 절단·공백 정리, limit 12 상한, type 기본 song', j.q.length === 60 && j.type === 'song' && u.includes('limit=12'));
  chk('limit 하한 1', (await (await run('q=a&limit=0')).json()).ok);

  mockFetch([['api.deezer.com/search/track', DZ_TRACKS]]);
  r = await run('', {});
  j = await r.json();
  chk('q 없는 GET = 진단(출처 무관): 검색 프로브 건수', r.status === 200 && j.제공처.startsWith('Deezer') && j.디저_검색 === 3);
  mockFetch([['api.deezer.com', { status: 429, body: {} }]]);
  j = await (await run('', {})).json();
  chk('진단: 실패면 상태 문구', j.디저_검색 === 'error: deezer 429');
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
