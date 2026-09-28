// Cloudflare Pages Function: /music-search — 마이페이지·팀 연습곡의 가수/곡 검색
//
// 배경(2026-09-28): 브라우저가 직접 쓰던 애플 iTunes Search API가 한국 스토어(country=KR)에서
// 곡(entity=song) 결과를 전부 0건으로 돌려주기 시작했다(뮤직비디오·아티스트만 반환). 코드 변경 없이 깨진 것.
// 대응: 애플 KR 뮤직비디오 검색(한글 표기·표지) + 스포티파이 검색(커버리지·앨범아트)을 서버에서 합쳐 준다.
//   - 애플 결과를 앞에, 스포티파이 결과를 뒤에. 같은 곡(제목+가수 정규화 일치)은 한 번만.
//   - 스포티파이는 Client Credentials — 시크릿은 서버에만, 토큰은 isolate 메모리에 캐시(만료 1분 전 갱신).
//   - 키가 없으면 스포티파이 블록은 조용히 꺼지고 애플 결과만 준다(sources.spotify:'disabled').
//   - 한 쪽이 실패해도 다른 쪽 결과는 준다. 둘 다 실패하면 502.
//
// GET /music-search?q=<검색어>&type=song|artist&limit=<1..12>
//   → { ok:true, q, type, results, sources:{ apple:<n>|'error', spotify:<n>|'error'|'disabled' } }
//     song  결과: [{ title, artist, artwork, source:'apple'|'spotify' }]
//     artist 결과: [{ name, image, source }]
// GET /music-search (q 없음) → 진단 JSON(키 원문 없음)
//
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

// 정규화 키 — 대소문자·공백·기호·괄호 안 부제("(feat. X)", "[Live]") 무시
export const normKey = (s) => String(s || '').toLowerCase().normalize('NFKC')
    .replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

// 이미지 목록에서 100px 이상 중 가장 작은 것(목록용) — 없으면 가장 큰 것
export function pickImage(images) {
    const arr = Array.isArray(images) ? images.filter(i => i && i.url).slice().sort((a, b) => (a.width || 0) - (b.width || 0)) : [];
    const s = arr.find(i => (i.width || 0) >= 100) || arr[arr.length - 1];
    return s ? s.url : '';
}

// ── 애플 iTunes KR 뮤직비디오 ────────────────────────────────────────────────
export async function appleSearch(q, type, limit) {
    const u = new URL('https://itunes.apple.com/search');
    u.searchParams.set('term', q);
    u.searchParams.set('country', 'KR');
    u.searchParams.set('entity', 'musicVideo');
    u.searchParams.set('lang', 'ko_kr');
    u.searchParams.set('limit', String(type === 'artist' ? 25 : Math.min(limit * 2, 25)));
    const r = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('apple ' + r.status);
    const d = await r.json().catch(() => ({}));
    const rows = Array.isArray(d.results) ? d.results : [];
    if (type === 'artist') {
        // 뮤직비디오의 artistName은 "Agust D & 아이유"처럼 합작 표기가 섞이므로 쪼개고, 검색어를 포함한 이름을 앞으로
        const names = [];
        for (const x of rows) for (const part of String(x.artistName || '').split(/\s*[&,]\s*|\s+feat\.?\s+/i)) if (part.trim()) names.push(part.trim());
        const ql = q.toLowerCase();
        names.sort((a, b) => Number(b.toLowerCase().includes(ql)) - Number(a.toLowerCase().includes(ql)));
        return names.map(name => ({ name, image: '', source: 'apple' }));
    }
    return rows.filter(x => x.trackName).map(x => ({
        title: String(x.trackName), artist: String(x.artistName || ''),
        artwork: x.artworkUrl100 || x.artworkUrl60 || '', source: 'apple',
    }));
}

// ── 스포티파이 (Client Credentials) ─────────────────────────────────────────
let _spToken = { value: '', exp: 0 };
export const _resetSpotifyToken = () => { _spToken = { value: '', exp: 0 }; };

async function spotifyToken(env) {
    if (_spToken.value && Date.now() < _spToken.exp - 60e3) return _spToken.value;
    const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
    });
    if (!r.ok) throw new Error('spotify token ' + r.status);
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
    if (!r.ok) throw new Error('spotify ' + r.status);
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

// ── 합치기 — 애플(한글) 먼저, 스포티파이로 채움. 애플이 많아도 스포티파이 자리 일부는 남긴다 ──
export function mergeResults(apple, spotify, type, limit) {
    const keyOf = type === 'artist' ? (x => normKey(x.name)) : (x => normKey(x.title) + '|' + normKey(x.artist));
    const seen = new Set();
    const uniq = (list) => list.filter(x => { const k = keyOf(x); if (!k || seen.has(k)) return false; seen.add(k); return true; });
    const a = uniq(apple);
    const s = uniq(spotify);
    const appleCap = s.length ? Math.max(1, Math.ceil(limit * 0.6)) : limit; // 스포티파이가 있으면 애플은 60%까지만 먼저
    const out = a.slice(0, appleCap).concat(s);
    if (out.length < limit) out.push(...a.slice(appleCap)); // 스포티파이가 적으면 남은 애플로 채움
    return out.slice(0, limit);
}

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
        status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders, ...extra },
    });
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_Q);
    const type = url.searchParams.get('type') === 'artist' ? 'artist' : 'song';
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 8));
    const spotifyOn = !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);

    // 진단 — 키 원문 없이 설정·연결 상태만
    if (!q) {
        const out = { 환경변수_SPOTIFY: spotifyOn, 스포티파이_인증: spotifyOn ? null : '꺼짐(키 없음)', 애플_KR_뮤직비디오: null };
        try { out.애플_KR_뮤직비디오 = (await appleSearch('잔나비', 'song', 3)).length; } catch (e) { out.애플_KR_뮤직비디오 = 'error'; }
        if (spotifyOn) { try { await spotifyToken(env); out.스포티파이_인증 = 'ok'; } catch (e) { out.스포티파이_인증 = String(e.message || e); } }
        return json(out);
    }
    if (!fromOurSite(request)) return json({ ok: false, error: 'forbidden' }, 403);

    // 캐시 — 검색어·종류·개수만으로 키를 만들어 www/pages.dev 가 공유
    const cacheKey = new Request(`https://gatherallaround.com/music-search?q=${encodeURIComponent(q.toLowerCase())}&type=${type}&limit=${limit}`);
    const cache = (typeof caches !== 'undefined' && caches.default) || null;
    if (cache) {
        try {
            const hit = await cache.match(cacheKey);
            if (hit) { const h = new Headers(hit.headers); for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v); return new Response(hit.body, { status: hit.status, headers: h }); }
        } catch (_) { /* 캐시 장애는 무시 */ }
    }

    const [ap, sp] = await Promise.allSettled([
        appleSearch(q, type, limit),
        spotifyOn ? spotifySearch(env, q, type, limit) : Promise.resolve(null),
    ]);
    const apple = ap.status === 'fulfilled' ? ap.value : [];
    const spotify = sp.status === 'fulfilled' && sp.value ? sp.value : [];
    const sources = {
        apple: ap.status === 'fulfilled' ? apple.length : 'error',
        spotify: !spotifyOn ? 'disabled' : (sp.status === 'fulfilled' ? spotify.length : 'error'),
    };
    if (ap.status === 'rejected' && (!spotifyOn || sp.status === 'rejected')) {
        return json({ ok: false, error: 'upstream', sources }, 502);
    }
    const results = mergeResults(apple, spotify, type, limit);
    const body = { ok: true, q, type, results, sources };
    const allGood = ap.status === 'fulfilled' && (!spotifyOn || sp.status === 'fulfilled');
    const res = json(body, 200, allGood ? { 'Cache-Control': `public, max-age=${CACHE_TTL}` } : { 'Cache-Control': 'no-store' });
    if (cache && allGood) {
        try { const put = cache.put(cacheKey, res.clone()); if (context.waitUntil) context.waitUntil(put); else await put; } catch (_) { /* 무시 */ }
    }
    return res;
}
