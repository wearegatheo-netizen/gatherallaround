// /music-search Cloudflare 함수 단위 테스트 — fetch 목으로 애플 KR 뮤직비디오 + 스포티파이 혼합 검색 검증
// 실행: node tests/music-search-unit.mjs
import { onRequest, mergeResults, normKey, pickImage, _resetSpotifyToken } from '../functions/music-search.js';

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

const APPLE_MV = { body: { resultCount: 3, results: [
  { wrapperType: 'track', kind: 'music-video', artistName: '잔나비', trackName: '주저하는 연인들을 위해', artworkUrl100: 'https://a/100.jpg', artworkUrl60: 'https://a/60.jpg' },
  { wrapperType: 'track', kind: 'music-video', artistName: '잔나비', trackName: '뜨거운 여름밤은 가고 남은 건 볼품없지만', artworkUrl60: 'https://a/b60.jpg' },
  { wrapperType: 'track', kind: 'music-video', artistName: 'Agust D & 잔나비', trackName: '합작곡', artworkUrl100: 'https://a/c.jpg' },
] } };
const SP_TOKEN = { body: { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 } };
const SP_TRACKS = { body: { tracks: { items: [
  { name: 'For Lovers Who Hesitate', artists: [{ name: 'JANNABI' }], album: { images: [{ url: 'https://s/640.jpg', width: 640 }, { url: 'https://s/300.jpg', width: 300 }, { url: 'https://s/64.jpg', width: 64 }] } },
  { name: '주저하는 연인들을 위해 (Live)', artists: [{ name: '잔나비' }], album: { images: [{ url: 'https://s/dup.jpg', width: 300 }] } }, // 애플과 같은 곡 → 제거
  { name: 'Dreams, Books, Power and Walls', artists: [{ name: 'JANNABI' }, { name: 'Someone' }], album: { images: [] } },
] } } };
const SP_ARTISTS = { body: { artists: { items: [
  { name: 'JANNABI', images: [{ url: 'https://s/a640.jpg', width: 640 }, { url: 'https://s/a160.jpg', width: 160 }] },
  { name: '잔나비', images: [] }, // 애플 이름과 같음 → 제거
] } } };

// ── 0. 순수 함수
{
  chk('normKey: 대소문자·공백·괄호 부제 무시', normKey('For Lovers Who Hesitate (feat. X)') === normKey('forloverswhohesitate') && normKey('주저하는 연인들을 위해 [Live]') === normKey('주저하는연인들을위해'));
  chk('pickImage: 100px 이상 중 가장 작은 것', pickImage([{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'tiny', width: 64 }]) === 'mid');
  chk('pickImage: 전부 작으면 가장 큰 것, 없으면 빈 문자열', pickImage([{ url: 't', width: 64 }]) === 't' && pickImage([]) === '' && pickImage(null) === '');
  const A = Array.from({ length: 10 }, (_, i) => ({ title: 'a' + i, artist: 'x' }));
  const S = Array.from({ length: 5 }, (_, i) => ({ title: 's' + i, artist: 'y' }));
  const m = mergeResults(A, S, 'song', 8);
  chk('merge: limit 8 → 애플 5 + 스포티파이 3', m.length === 8 && m.slice(0, 5).every(x => x.title.startsWith('a')) && m.slice(5).every(x => x.title.startsWith('s')), m.map(x => x.title).join(','));
  const m2 = mergeResults(A, S.slice(0, 1), 'song', 8);
  chk('merge: 스포티파이가 적으면 남은 애플로 채움', m2.length === 8 && m2.filter(x => x.title.startsWith('a')).length === 7);
  chk('merge: 스포티파이 없으면 애플만 limit 까지', mergeResults(A, [], 'song', 8).length === 8);
  const m3 = mergeResults([{ title: 'Song', artist: 'Band' }], [{ title: 'song (Live)', artist: 'BAND' }, { title: 'Other', artist: 'Band' }], 'song', 8);
  chk('merge: 정규화 키 같은 곡은 한 번만', m3.length === 2 && m3[1].title === 'Other');
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
  mockFetch([['itunes.apple.com', APPLE_MV]]);
  r = await run('q=잔나비', ENV_NONE, { Referer: 'https://www.gatherallaround.com/' });
  chk('Referer 가 우리 도메인이면 통과', r.status === 200);
  mockFetch([['itunes.apple.com', APPLE_MV]]);
  r = await run('q=잔나비', ENV_NONE, { Origin: 'https://gatherallaround.pages.dev' });
  chk('Origin 이 pages.dev 미리보기여도 통과', r.status === 200);
  mockFetch([['itunes.apple.com', APPLE_MV]]);
  r = await run('q=잔나비', ENV_NONE, { Referer: 'https://evil.example/' });
  chk('남의 사이트 Referer → 403', r.status === 403);
}

// ── 2. 스포티파이 키 없음 → 애플만
{
  _resetSpotifyToken(); mockFetch([['itunes.apple.com', APPLE_MV]]);
  const r = await run('q=잔나비&type=song&limit=8', ENV_NONE);
  const j = await r.json();
  chk('키 없으면 애플 결과만, sources.spotify=disabled', r.status === 200 && j.ok && j.sources.spotify === 'disabled' && j.sources.apple === 3 && j.results.length === 3 && n('spotify') === 0);
  chk('애플 결과 형식 title/artist/artwork(100 우선)/source', j.results[0].title === '주저하는 연인들을 위해' && j.results[0].artist === '잔나비' && j.results[0].artwork === 'https://a/100.jpg' && j.results[0].source === 'apple' && j.results[1].artwork === 'https://a/b60.jpg');
  const au = calls.find(c => c.url.includes('itunes')).url;
  chk('애플 호출: country=KR, entity=musicVideo, lang=ko_kr', au.includes('country=KR') && au.includes('entity=musicVideo') && au.includes('lang=ko_kr'));
  chk('성공 응답은 1일 캐시 헤더', (r.headers.get('Cache-Control') || '').includes('max-age=86400'));
}

// ── 3. 스포티파이 켜짐 — 토큰 1회 발급·재사용, 합치기·중복 제거
{
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', APPLE_MV], ['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_TRACKS]]);
  let r = await run('q=잔나비&type=song&limit=8');
  let j = await r.json();
  chk('애플 3 + 스포티파이 2(중복 1 제외) = 5건, 애플이 앞', j.results.length === 5 && j.results.slice(0, 3).every(x => x.source === 'apple') && j.results.slice(3).every(x => x.source === 'spotify'), j.results.map(x => x.title).join(' | '));
  chk('스포티파이 결과: 여러 아티스트는 ", " 연결, 앨범 이미지 300 선택, 이미지 없으면 빈 문자열',
    j.results[3].artist === 'JANNABI' && j.results[3].artwork === 'https://s/300.jpg' && j.results[4].artist === 'JANNABI, Someone' && j.results[4].artwork === '');
  chk('sources 카운트는 원본 건수', j.sources.apple === 3 && j.sources.spotify === 3);
  const tok = calls.find(c => c.url.includes('api/token'));
  chk('토큰 요청: Basic base64(id:secret), grant_type=client_credentials', tok && tok.method === 'POST' && tok.headers.Authorization === 'Basic ' + Buffer.from('cid-test:secret-test').toString('base64') && String(tok.body).includes('grant_type=client_credentials'));
  const su = calls.find(c => c.url.includes('v1/search'));
  chk('검색 요청: Bearer 토큰, type=track, market=KR', su.headers.Authorization === 'Bearer tok-1' && su.url.includes('type=track') && su.url.includes('market=KR'));

  // 두 번째 검색 — 토큰 재발급 없음
  const before = n('api/token');
  r = await run('q=아이유&type=song');
  chk('두 번째 검색은 토큰 캐시 재사용', r.status === 200 && n('api/token') === before);
}

// ── 4. 401 → 토큰 재발급 후 1회 재시도
{
  _resetSpotifyToken();
  let searchCalls = 0;
  mockFetch([['itunes.apple.com', APPLE_MV], ['accounts.spotify.com/api/token', SP_TOKEN],
    ['api.spotify.com/v1/search', () => (++searchCalls === 1 ? { status: 401, body: { error: 'expired' } } : SP_TRACKS)]]);
  const r = await run('q=잔나비');
  const j = await r.json();
  chk('401 이면 토큰 다시 받고 재시도해 성공', r.status === 200 && j.sources.spotify === 3 && searchCalls === 2 && n('api/token') === 2);
}

// ── 5. 한쪽 실패 / 둘 다 실패
{
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', { status: 503, body: {} }], ['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_TRACKS]]);
  let r = await run('q=잔나비');
  let j = await r.json();
  chk('애플 실패 → 스포티파이 결과로 200, sources.apple=error(+errors.apple 상태), 캐시 안 함', r.status === 200 && j.ok && j.sources.apple === 'error' && j.errors.apple === 'apple 503' && j.results.length === 3 && r.headers.get('Cache-Control') === 'no-store');
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', APPLE_MV], ['accounts.spotify.com/api/token', { status: 400, body: { error: 'invalid_client' } }]]);
  r = await run('q=잔나비');
  j = await r.json();
  chk('스포티파이 인증 실패 → 애플 결과로 200, sources.spotify=error', r.status === 200 && j.sources.spotify === 'error' && j.results.length === 3);
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', { status: 500, body: {} }], ['accounts.spotify.com/api/token', { status: 500, body: {} }]]);
  r = await run('q=잔나비');
  j = await r.json();
  chk('둘 다 실패 → 502 upstream + 원인 상태', r.status === 502 && j.error === 'upstream' && j.errors.apple === 'apple 500' && j.errors.spotify === 'spotify token 500');
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', { status: 500, body: {} }]]);
  r = await run('q=잔나비', ENV_NONE);
  chk('키 없고 애플도 실패 → 502', r.status === 502);
}

// ── 6. 가수 검색
{
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', APPLE_MV], ['accounts.spotify.com/api/token', SP_TOKEN], ['api.spotify.com/v1/search', SP_ARTISTS]]);
  const r = await run('q=잔나비&type=artist&limit=6');
  const j = await r.json();
  const names = j.results.map(x => x.name);
  chk('가수: 합작 표기 분리·중복 제거, 검색어 포함 이름 먼저', names[0] === '잔나비' && names.includes('Agust D') && names.filter(x => x === '잔나비').length === 1, names.join(','));
  chk('가수: 스포티파이 JANNABI 추가(이미지 160 선택), 같은 이름 "잔나비"는 제거', names.includes('JANNABI') && j.results.find(x => x.name === 'JANNABI').image === 'https://s/a160.jpg' && j.results.filter(x => x.source === 'spotify').length === 1);
  const su = calls.find(c => c.url.includes('v1/search'));
  chk('가수 검색은 type=artist 로 스포티파이 호출', su.url.includes('type=artist'));
}

// ── 7. 입력 정리·진단
{
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', APPLE_MV]]);
  const long = 'ㄱ'.repeat(80);
  let r = await run('q=' + encodeURIComponent('  ' + long + '  ') + '&limit=50&type=weird', ENV_NONE);
  let j = await r.json();
  const au = calls.find(c => c.url.includes('itunes')).url;
  chk('q 60자 절단·공백 정리, limit 12 상한, type 기본 song', j.q.length === 60 && j.type === 'song' && au.includes('limit=24'));
  chk('limit 하한 1', (await (await run('q=a&limit=0', ENV_NONE)).json()).ok);

  mockFetch([['itunes.apple.com', APPLE_MV]]);
  r = await run('', ENV_NONE, {});
  j = await r.json();
  chk('q 없는 GET = 진단(출처 무관): 키 없음 표시, 애플 프로브 건수', r.status === 200 && j.환경변수_SPOTIFY === false && j.스포티파이_인증 === '꺼짐(키 없음)' && j.애플_KR_뮤직비디오 === 3);
  const au2 = calls.find(c => c.url.includes('itunes'));
  chk('외부 호출에 User-Agent·Accept-Language 동봉', /gatherallaround/.test(au2.headers['User-Agent']) && /ko-KR/.test(au2.headers['Accept-Language']));
  mockFetch([['itunes.apple.com', { status: 403, body: {} }]]);
  j = await (await run('', ENV_NONE, {})).json();
  chk('진단: 애플 실패면 상태 코드 문구', j.애플_KR_뮤직비디오 === 'error: apple 403');
  mockFetch([['itunes.apple.com', { status: 500, body: {} }]]);
  globalThis.fetch = () => { throw new TypeError('boom'); }; // 동기 throw 도 allSettled 가 거부로 받아 502
  r = await run('q=x', ENV_NONE);
  chk('외부 호출이 동기 예외를 던져도 502 upstream', r.status === 502 && (await r.json()).errors.apple === 'boom');
  globalThis.caches = { get default() { throw new Error('cache broken'); } }; // 런타임 객체 자체가 깨진 경우
  r = await run('q=x', ENV_NONE);
  delete globalThis.caches;
  chk('예기치 못한 예외 → JSON 500 internal (Cloudflare 기본 오류문 아님)', r.status === 500 && (await r.json()).error === 'internal');
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', APPLE_MV], ['accounts.spotify.com/api/token', SP_TOKEN]]);
  j = await (await run('', ENV_SP, {})).json();
  chk('진단: 키 있으면 토큰 발급 시도 → ok (키 원문 없음)', j.환경변수_SPOTIFY === true && j.스포티파이_인증 === 'ok' && !JSON.stringify(j).includes('secret-test'));
  _resetSpotifyToken();
  mockFetch([['itunes.apple.com', APPLE_MV], ['accounts.spotify.com/api/token', { status: 400, body: { error: 'invalid_client' } }]]);
  j = await (await run('', ENV_SP, {})).json();
  chk('진단: 인증 실패면 상태 문구', j.스포티파이_인증 === 'spotify token 400');
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
