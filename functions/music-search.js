// Cloudflare Pages Function: /music-search — 스포티파이 검색 프록시 (마이페이지 음악 취향·팀 연습곡 검색의 한 축)
//
// 배경(2026-09-28): 브라우저가 직접 쓰던 애플 iTunes Search API가 한국 스토어(country=KR)에서 곡(entity=song)
// 결과를 전부 0건으로 돌려주기 시작했다(뮤직비디오·아티스트만 반환). 코드 변경 없이 깨진 것. 대응은 두 축:
//   1) 애플 KR 뮤직비디오 검색(한글 표기·표지) — 브라우저가 직접 호출(CORS *). Cloudflare Workers 에서 호출하면
//      공유 egress IP 라 애플이 429 로 막아(실측) 서버로 옮길 수 없다.
//   2) 스포티파이 검색(커버리지·앨범아트) — 이 함수. Client Credentials 시크릿은 서버에만, 토큰은 isolate 메모리 캐시.
// 두 결과 합치기(애플 먼저·정규화 키 중복 제거)는 index.html musicSearch() 가 한다.
//
// GET /music-search?q=<검색어>&type=song|artist&limit=<1..12>
//   → { ok:true, q, type, results, sources:{ spotify:<n>|'disabled' } }
//     song 결과: [{ title, artist, artwork, source:'spotify' }] / artist 결과: [{ name, image, source }]
//   키 없음 → ok:true, results:[] (클라는 애플만으로 동작). 스포티파이 실패 → 500 { ok:false, error:'upstream' }
//   (502 로 주면 Cloudflare 가 본문을 자체 오류문 "error code: 502" 로 바꿔 진단이 안 된다 — 실측)
// GET /music-search (q 없음) → 진단 JSON(키 원문 없음)
// 남용 방지(보안 아님, 스포티파이 쿼터 보호): 검색은 우리 사이트에서 온 요청만
//   (Sec-Fetch-Site same-origin/same-site 또는 Origin/Referer 호스트가 우리 도메인), q ≤ 60자, limit ≤ 12,
//   성공 응답은 Cache API·브라우저에 1일 캐시.
// Env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET

const MAX_Q = 60;
const MAX_LIMIT = 12;
const CACHE_TTL = 86400; // 1일

function corsFor(origin) {
    const host = hostOf(origin);
    const allowed = origin && (
        origin === 'https://gatherallaround.com' ||
        origin === 'https://www.gatherallaround.com' ||
        /\.(pages\.dev|gatherallaround\.com)$/.test(host)
    );
    return {
        'Access-Control-Allow-Origin': allowed ? origin : 'https://gatherallaround.com',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}

function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }
const isOurHost = (h) => h === 'gatherallaround.com' || h === 'localhost' || /\.(gatherallaround\.com|pages\.dev)$/.test(h);

// 우리 사이트에서 온 요청인가 — 같은 출처 GET에는 Origin이 없으므로 Sec-Fetch-Site·Referer도 본다
export function fromOurSite(request) {
    const sfs = request.headers.get('Sec-Fetch-Site');
    if (sfs === 'same-origin' || sfs === 'same-site') return true;
    return isOurHost(hostOf(request.headers.get('Origin') || '')) || isOurHost(hostOf(request.headers.get('Referer') || ''));
}

// 이미지 목록에서 100px 이상 중 가장 작은 것(목록용) — 없으면 가장 큰 것
export function pickImage(images) {
    const arr = Array.isArray(images) ? images.filter(i => i && i.url).slice().sort((a, b) => (a.width || 0) - (b.width || 0)) : [];
    const s = arr.find(i => (i.width || 0) >= 100) || arr[arr.length - 1];
    return s ? s.url : '';
}

// ── 스포티파이 (Client Credentials) ─────────────────────────────────────────
// 오류 본문에서 사람이 읽을 메시지만 짧게 — 진단용(키·토큰 없음). {"error":{"message":..}} / {"error_description":..} / 텍스트
function spotifyErrMsg(text) {
    let m = '';
    try { const j = JSON.parse(text); m = (j.error && j.error.message) || j.error_description || (typeof j.error === 'string' ? j.error : ''); } catch { m = String(text || ''); }
    m = String(m || '').replace(/\s+/g, ' ').trim().slice(0, 150);
    return m ? ': ' + m : '';
}
let _spToken = { value: '', exp: 0 };
export const _resetSpotifyToken = () => { _spToken = { value: '', exp: 0 }; };

async function spotifyToken(env) {
    if (_spToken.value && Date.now() < _spToken.exp - 60e3) return _spToken.value;
    const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
    });
    if (!r.ok) throw new Error('spotify token ' + r.status + spotifyErrMsg(await r.text().catch(() => '')));
    const d = await r.json().catch(() => ({}));
    if (!d.access_token) throw new Error('spotify token empty');
    _spToken = { value: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
    return _spToken.value;
}

export async function spotifySearch(env, q, type, limit) {
    const u = new URL('https://api.spotify.com/v1/search');
    u.searchParams.set('q', q);
    u.searchParams.set('type', type === 'artist' ? 'artist' : 'track');
    u.searchParams.set('market', 'KR');
    u.searchParams.set('limit', String(Math.min(limit, 20)));
    const call = async () => fetch(u.toString(), { headers: { Authorization: 'Bearer ' + await spotifyToken(env) } });
    let r = await call();
    if (r.status === 401) { _resetSpotifyToken(); r = await call(); } // 토큰 만료·폐기 → 1회 재발급
    if (!r.ok) throw new Error('spotify ' + r.status + spotifyErrMsg(await r.text().catch(() => '')));
    const d = await r.json().catch(() => ({}));
    if (type === 'artist') {
        return ((d.artists && d.artists.items) || []).filter(a => a && a.name)
            .map(a => ({ name: String(a.name), image: pickImage(a.images), source: 'spotify' }));
    }
    return ((d.tracks && d.tracks.items) || []).filter(t => t && t.name).map(t => ({
        title: String(t.name), artist: (t.artists || []).map(a => a.name).filter(Boolean).join(', '),
        artwork: pickImage(t.album && t.album.images), source: 'spotify',
    }));
}

export async function onRequest(context) {
    const { request } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
        status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders, ...extra },
    });
    try {
        return await handle(context, json, corsHeaders);
    } catch (e) {
        return json({ ok: false, error: 'internal', message: String(e && e.message || e).slice(0, 200) }, 500);
    }
}

async function handle(context, json, corsHeaders) {
    const { request, env } = context;
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_Q);
    const type = url.searchParams.get('type') === 'artist' ? 'artist' : 'song';
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 8));
    const spotifyOn = !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);

    // 진단 — 키 원문 없이 설정·연결 상태만
    if (!q) {
        const out = { 환경변수_SPOTIFY: spotifyOn, 스포티파이_인증: spotifyOn ? null : '꺼짐(키 없음)', 스포티파이_검색: null };
        if (spotifyOn) {
            try { await spotifyToken(env); out.스포티파이_인증 = 'ok'; } catch (e) { out.스포티파이_인증 = String(e.message || e).slice(0, 120); }
            if (out.스포티파이_인증 === 'ok') {
                try { out.스포티파이_검색 = (await spotifySearch(env, '잔나비', 'song', 3)).length; } catch (e) { out.스포티파이_검색 = 'error: ' + String(e.message || e).slice(0, 120); }
            }
        }
        return json(out);
    }
    if (!fromOurSite(request)) return json({ ok: false, error: 'forbidden' }, 403);
    if (!spotifyOn) return json({ ok: true, q, type, results: [], sources: { spotify: 'disabled' } });

    // 캐시 — 검색어·종류·개수만으로 키를 만들어 www/pages.dev 가 공유
    const cacheKey = new Request(`https://gatherallaround.com/music-search?q=${encodeURIComponent(q.toLowerCase())}&type=${type}&limit=${limit}`);
    const cache = (typeof caches !== 'undefined' && caches.default) || null;
    if (cache) {
        try {
            const hit = await cache.match(cacheKey);
            if (hit) { const h = new Headers(hit.headers); for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v); return new Response(hit.body, { status: hit.status, headers: h }); }
        } catch (_) { /* 캐시 장애는 무시 */ }
    }

    let results;
    try { results = await spotifySearch(env, q, type, limit); }
    catch (e) { return json({ ok: false, error: 'upstream', errors: { spotify: String(e && e.message || e).slice(0, 120) } }, 500, { 'Cache-Control': 'no-store' }); }

    const res = json({ ok: true, q, type, results, sources: { spotify: results.length } }, 200, { 'Cache-Control': `public, max-age=${CACHE_TTL}` });
    if (cache) {
        try { const put = cache.put(cacheKey, res.clone()); if (context.waitUntil) context.waitUntil(put); else await put; } catch (_) { /* 무시 */ }
    }
    return res;
}
