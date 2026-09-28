// Cloudflare Pages Function: /music-search — Deezer 검색 프록시 (마이페이지 음악 취향·팀 연습곡 검색의 한 축)
//
// 배경(2026-09-28): 브라우저가 직접 쓰던 애플 iTunes Search API가 한국 스토어(country=KR)에서 곡(entity=song)
// 결과를 전부 0건으로 돌려주기 시작했다(뮤직비디오·아티스트만 반환). 코드 변경 없이 깨진 것. 대응은 두 축:
//   1) 애플 KR 뮤직비디오 검색(한글 표기·표지) — 브라우저가 직접 호출(CORS *). Cloudflare Workers 에서 호출하면
//      공유 egress IP 라 애플이 429 로 막아(실측) 서버로 옮길 수 없다.
//   2) Deezer 검색(커버리지·앨범아트, 무료·키 없음) — 이 함수. Deezer 는 CORS 를 열지 않아(JSONP만) 서버 경유가 필요하다.
//      (처음엔 스포티파이 프록시였으나 2025년 이후 "앱 소유 계정 프리미엄 구독 필수" 정책으로 403 — 같은 날 Deezer 로 교체.
//       SPOTIFY_CLIENT_ID/SECRET 환경변수는 더 쓰지 않는다.)
// 두 결과 합치기(애플 먼저·정규화 키 중복 제거)는 index.html musicSearch() 가 한다.
//
// GET /music-search?q=<검색어>&type=song|artist&limit=<1..12>
//   → { ok:true, q, type, results, sources:{ deezer:<n> } }
//     song 결과: [{ title, artist, artwork, source:'deezer' }] / artist 결과: [{ name, image, source }]
//   Deezer 실패 → 500 { ok:false, error:'upstream', errors:{ deezer:'...' } }
//   (502 로 주면 Cloudflare 가 본문을 자체 오류문 "error code: 502" 로 바꿔 진단이 안 된다 — 실측)
//   Deezer 는 오류를 HTTP 200 본문 { error:{ type, message, code } } 로도 준다(쿼터 초과 code 4 등) — 본문도 검사.
// GET /music-search (q 없음) → 진단 JSON
// 남용 방지(Deezer 쿼터 IP당 5초 50회 보호): 검색은 우리 사이트에서 온 요청만
//   (Sec-Fetch-Site same-origin/same-site 또는 Origin/Referer 호스트가 우리 도메인), q ≤ 60자, limit ≤ 12,
//   성공 응답은 Cache API·브라우저에 1일 캐시.
// Env: 없음

const MAX_Q = 60;
const MAX_LIMIT = 12;
const CACHE_TTL = 86400; // 1일
const DEEZER = 'https://api.deezer.com';

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

// ── Deezer ──────────────────────────────────────────────────────────────────
// 오류 문구 — 진단용, 150자까지
const shortMsg = (m) => { m = String(m || '').replace(/\s+/g, ' ').trim().slice(0, 150); return m ? ': ' + m : ''; };

export async function deezerSearch(q, type, limit) {
    const u = new URL(`${DEEZER}/search/${type === 'artist' ? 'artist' : 'track'}`);
    u.searchParams.set('q', q);
    u.searchParams.set('limit', String(Math.min(limit, 25)));
    const r = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
    const text = await r.text().catch(() => '');
    let d = null;
    try { d = JSON.parse(text); } catch (_) { d = null; }
    if (!r.ok) throw new Error('deezer ' + r.status + shortMsg(d ? (d.error && d.error.message) || '' : text)); // JSON 이면 메시지만, 아니면 본문 앞부분
    if (!d || typeof d !== 'object') throw new Error('deezer bad response' + shortMsg(text));
    if (d.error) {
        if (Number(d.error.code) === 800) return []; // "no data" — 결과 없음으로 취급
        throw new Error('deezer code ' + (d.error.code != null ? d.error.code : '?') + shortMsg(d.error.message || d.error.type));
    }
    const rows = Array.isArray(d.data) ? d.data : [];
    if (type === 'artist') {
        return rows.filter(a => a && a.name).map(a => ({
            name: String(a.name), image: a.picture_medium || a.picture_small || a.picture || '', source: 'deezer',
        }));
    }
    return rows.filter(t => t && t.title).map(t => ({
        title: String(t.title), artist: String((t.artist && t.artist.name) || ''),
        artwork: (t.album && (t.album.cover_medium || t.album.cover_small || t.album.cover)) || '', source: 'deezer',
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
    const { request } = context;
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'GET') return json({ ok: false, error: 'method' }, 405);

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_Q);
    const type = url.searchParams.get('type') === 'artist' ? 'artist' : 'song';
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 8));

    // 진단 — 연결 상태만 (검색 프로브 1회)
    if (!q) {
        const out = { 제공처: 'Deezer(무료·키 없음)', 디저_검색: null };
        try { out.디저_검색 = (await deezerSearch('잔나비', 'song', 3)).length; } catch (e) { out.디저_검색 = 'error: ' + String(e && e.message || e).slice(0, 150); }
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

    let results;
    try { results = await deezerSearch(q, type, limit); }
    catch (e) { return json({ ok: false, error: 'upstream', errors: { deezer: String(e && e.message || e).slice(0, 160) } }, 500, { 'Cache-Control': 'no-store' }); }

    const res = json({ ok: true, q, type, results, sources: { deezer: results.length } }, 200, { 'Cache-Control': `public, max-age=${CACHE_TTL}` });
    if (cache) {
        try { const put = cache.put(cacheKey, res.clone()); if (context.waitUntil) context.waitUntil(put); else await put; } catch (_) { /* 무시 */ }
    }
    return res;
}
