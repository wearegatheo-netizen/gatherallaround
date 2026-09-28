// /music-search Cloudflare 함수 단위 테스트 — fetch 목으로 스포티파이 프록시 검증
// (애플 KR 뮤직비디오 검색·두 결과 합치기는 브라우저 쪽 index.html musicSearch() — Playwright UI 테스트에서 검증)
// 실행: node tests/music-search-unit.mjs
import { onRequest, pickImage, _resetSpotifyToken } from '../functions/music-search.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV_SP = { SPOTIFY_CLIENT_ID: 'cid-test', SPOTIFY_CLIENT_SECRET: 'secret-test' };
const ENV_NONE = {};

const req = (qs, headers = { 'Sec-Fetch-Site': 'same-origin' }, method = 'GET') =>
  new Request('https://gatherallaround.com/music-search' + (qs ? '?' + qs : ''), { method, headers });
const run = (qs, env = ENV_SP, headers) => onRequest({ request: req(qs, headers), env });

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
    calls.push(rec);
    for (const [pat, resp] of routes) {
      if (rec.url.includes(pat)) {
        const r = typeof resp === 'function' ? resp(rec) : resp;
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    throw new Error('unexpected fetch: ' + rec.method + ' ' + rec.url);
  };
}
const n = (pat) => calls.filter(c => c.url.includes(pat)).length;

const SP_TOKEN = { body: { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 } };
const SP_TRACKS = { body: { tracks: { items: [
  { name: 'For Lovers Who Hesitate', artists: [{ name: 'JANNABI' }], album: { images: [{ url: 'https://s/640.jpg', width: 640 }, { url: 'https://s/300.jpg', width: 300 }, { url: 'https://s/64.jpg', width: 64 }] } },
  { name: '주저하는 연인들을 위해 (Live)', artists: [{ name: '잔나비' }], album: { images: [{ url: 'https://s/dup.jpg', width: 300 }] } },
  { name: 'Dreams, Books, Power and Walls', artists: [{ name: 'JANNABI' }, { name: 'Someone' }], album: { images: [] } },
] } } };
const SP_ARTISTS = { body: { artists: { items: [
  { name: 'JANNABI', images: [{ url: 'https://s/a640.jpg', width: 640 }, { url: 'https://s/a160.jpg', width: 160 }] },
  { name: '잔나비', images: [] },
] } } };

// ── 0. 순수 함수
{
  chk('pickImage: 100px 이상 중 가장 작은 것', pickImage([{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'tiny', width: 64 }]) === 'mid');
  chk('pickImage: 전부 작으면 가장 큰 것, 없으면 빈 문자열', pickImage([{ url: 't', width: 64 }]) === 't' && pickImage([]) === '' && pickImage(null) === '');
}

// ── 1. 메서드·게이트
{
  mockFetch([]);
  let r = await onRequest({ request: req('q=x', {}, 'OPTIONS'), env: ENV_SP });
  chk('OPTIONS → CORS 헤더', r.headers.get('Access-Control-Allow-Origin') === 'https://gatherallaround.com');
  r = await onRequest({ request: req('q=x', {}, 'POST'), env: ENV_SP });
  chk('POST → 405', r.status === 405);
  r = await run('q=잔나비', ENV_SP, {});
  chk('출처 헤더 없는 검색 → 403, 외부 호출 없음', r.status === 403 && calls.length === 0);
  _resetSpotifyToken(); mockFetch([['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_TRACKS]]);
  r = await run('q=잔나비', ENV_SP, { Referer: 'https://www.gatherallaround.com/' });
  chk('Referer 가 우리 도메인이면 통과', r.status === 200);
  r = await run('q=잔나비', ENV_SP, { Origin: 'https://gatherallaround.pages.dev' });
  chk('Origin 이 pages.dev 미리보기여도 통과', r.status === 200);
  r = await run('q=잔나비', ENV_SP, { Referer: 'https://evil.example/' });
  chk('남의 사이트 Referer → 403', r.status === 403);
}

// ── 2. 키 없음 → 빈 결과(ok), 외부 호출 없음
{
  mockFetch([]);
  const r = await run('q=잔나비&type=song&limit=8', ENV_NONE);
  const j = await r.json();
  chk('키 없으면 ok:true·results 빈 배열·sources.spotify=disabled, 외부 호출 없음', r.status === 200 && j.ok && j.results.length === 0 && j.sources.spotify === 'disabled' && calls.length === 0);
}

// ── 3. 검색 — 토큰 1회 발급·재사용, 결과 형식
{
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_TRACKS]]);
  let r = await run('q=잔나비&type=song&limit=8');
  let j = await r.json();
  chk('곡 3건, source=spotify, sources.spotify=3', j.ok && j.results.length === 3 && j.results.every(x => x.source === 'spotify') && j.sources.spotify === 3);
  chk('결과 형식: 여러 아티스트는 ", " 연결, 앨범 이미지 300 선택, 이미지 없으면 빈 문자열',
    j.results[0].artist === 'JANNABI' && j.results[0].artwork === 'https://s/300.jpg' && j.results[2].artist === 'JANNABI, Someone' && j.results[2].artwork === '');
  const tok = calls.find(c => c.url.includes('api/token'));
  chk('토큰 요청: Basic base64(id:secret), grant_type=client_credentials', tok && tok.method === 'POST' && tok.headers.Authorization === 'Basic ' + Buffer.from('cid-test:secret-test').toString('base64') && String(tok.body).includes('grant_type=client_credentials'));
  const su = calls.find(c => c.url.includes('v1/search'));
  chk('검색 요청: Bearer 토큰, type=track, market=KR, limit=8', su.headers.Authorization === 'Bearer tok-1' && su.url.includes('type=track') && su.url.includes('market=KR') && su.url.includes('limit=8'));
  chk('성공 응답은 1일 캐시 헤더', (r.headers.get('Cache-Control') || '').includes('max-age=86400'));
  const before = n('api/token');
  r = await run('q=아이유&type=song');
  chk('두 번째 검색은 토큰 캐시 재사용', r.status === 200 && n('api/token') === before);
}

// ── 4. 401 → 토큰 재발급 후 1회 재시도
{
  _resetSpotifyToken();
  let searchCalls = 0;
  mockFetch([['accounts.spotify.com/api/token', SP_TOKEN],
    ['api.spotify.com/v1/search', () => (++searchCalls === 1 ? { status: 401, body: { error: 'expired' } } : SP_TRACKS)]]);
  const r = await run('q=잔나비');
  const j = await r.json();
  chk('401 이면 토큰 다시 받고 재시도해 성공', r.status === 200 && j.sources.spotify === 3 && searchCalls === 2 && n('api/token') === 2);
}

// ── 5. 실패 — 500 JSON (502 는 Cloudflare 가 본문을 가림), 캐시 안 함
{
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', { status: 400, body: { error: 'invalid_client', error_description: 'Invalid client secret' } }]]);
  let r = await run('q=잔나비');
  let j = await r.json();
  chk('인증 실패 → 500 upstream + 원인 상태·메시지, no-store', r.status === 500 && j.ok === false && j.error === 'upstream' && j.errors.spotify === 'spotify token 400: Invalid client secret' && r.headers.get('Cache-Control') === 'no-store');
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', { status: 403, body: { error: { status: 403, message: 'Spotify Premium required' } } }]]);
  r = await run('q=잔나비');
  j = await r.json();
  chk('검색 403 → 본문 메시지 동봉 "spotify 403: ..."', r.status === 500 && j.errors.spotify === 'spotify 403: Spotify Premium required');
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', { status: 429, body: {} }]]);
  r = await run('q=잔나비');
  j = await r.json();
  chk('검색 429 → 500 upstream "spotify 429"', r.status === 500 && j.errors.spotify === 'spotify 429');
  _resetSpotifyToken();
  mockFetch([]);
  globalThis.fetch = () => { throw new TypeError('boom'); };
  r = await run('q=x');
  chk('외부 호출이 동기 예외를 던져도 500 upstream JSON', r.status === 500 && (await r.json()).errors.spotify === 'boom');
  globalThis.caches = { get default() { throw new Error('cache broken'); } }; // 런타임 객체 자체가 깨진 경우
  r = await run('q=x');
  delete globalThis.caches;
  chk('예기치 못한 예외 → JSON 500 internal (Cloudflare 기본 오류문 아님)', r.status === 500 && (await r.json()).error === 'internal');
}

// ── 6. 가수 검색
{
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_ARTISTS]]);
  const r = await run('q=잔나비&type=artist&limit=6');
  const j = await r.json();
  chk('가수: name/image(160 선택)/source', j.results.length === 2 && j.results[0].name === 'JANNABI' && j.results[0].image === 'https://s/a160.jpg' && j.results[1].image === '' && j.type === 'artist');
  const su = calls.find(c => c.url.includes('v1/search'));
  chk('가수 검색은 type=artist 로 스포티파이 호출', su.url.includes('type=artist'));
}

// ── 7. 입력 정리·진단
{
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_TRACKS]]);
  const long = 'ㄱ'.repeat(80);
  let r = await run('q=' + encodeURIComponent('  ' + long + '  ') + '&limit=50&type=weird');
  let j = await r.json();
  const su = calls.find(c => c.url.includes('v1/search')).url;
  chk('q 60자 절단·공백 정리, limit 12 상한, type 기본 song', j.q.length === 60 && j.type === 'song' && su.includes('limit=12'));
  chk('limit 하한 1', (await (await run('q=a&limit=0')).json()).ok);

  mockFetch([]);
  r = await run('', ENV_NONE, {});
  j = await r.json();
  chk('q 없는 GET = 진단(출처 무관): 키 없음 표시, 외부 호출 없음', r.status === 200 && j.환경변수_SPOTIFY === false && j.스포티파이_인증 === '꺼짐(키 없음)' && calls.length === 0);
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_TRACKS]]);
  j = await (await run('', ENV_SP, {})).json();
  chk('진단: 키 있으면 인증 ok + 검색 프로브 건수 (키 원문 없음)', j.환경변수_SPOTIFY === true && j.스포티파이_인증 === 'ok' && j.스포티파이_검색 === 3 && !JSON.stringify(j).includes('secret-test'));
  _resetSpotifyToken();
  mockFetch([['accounts.spotify.com/api/token', { status: 400, body: { error: 'invalid_client' } }]]);
  j = await (await run('', ENV_SP, {})).json();
  chk('진단: 인증 실패면 상태 문구, 검색 프로브 생략', j.스포티파이_인증 === 'spotify token 400: invalid_client' && j.스포티파이_검색 === null);
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
