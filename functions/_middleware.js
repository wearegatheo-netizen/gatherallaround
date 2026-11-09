// Cloudflare Pages middleware
// ?news=<fileId> 요청에 대해 Drive에서 기사 제목을 가져와 OG 태그를 동적으로 주입.
// 메신저 크롤러(KakaoTalk, Facebook 등)가 정적 HTML을 읽을 때 기사별 미리보기가 표시됨.
// 포스터 꾸미기 공유 링크(표준은 경로형 /wp/<id>·/ww/<id> — functions/wp|ww/[id].js 가 처리). 여기서는 예전 쿼리형
// 루트 /?wp=<프로젝트 id>·/?ww=<작품 id> 와 /wappen/?p=·?w= 를 받아, 사람(브라우저)은 HTTP 302 로 /wappen/#/… 에 바로 보내고
// (JS 실행에 의존하지 않음 — 2026-10-06 카톡 인앱에서 포털에 멈추던 문제), 크롤러에게만 작품·프로젝트별 OG 태그를 주입한다.
// 경로형 섹션 주소(2026-11-05): /perf · /shows/<id> · /gatheo/board/<id> … 처럼 # 없이 들어와도 같은 화면 — 아래 appRouteFromPath 참고.
import { isCrawler, injectOg } from '../wappen/share-page.js';
import { onRequest as showShare } from './show/[id].js';
import { onRequest as meetShare } from './meet/[id].js';

// ── 경로형 섹션 주소(2026-11-05) ─────────────────────────────────────────────
// 인스타그램 프로필 링크·카카오톡 등 인앱 브라우저는 URL 의 #해시를 버려 `/#perf` 같은 링크가 포털에서 멈춘다.
// SPA 섹션(index.html _NAV_PAGES)의 모든 해시 주소를 경로로도 받는다: /perf = /#perf, /gatheo/board/<id> = /#gatheo/board/<id>.
// 루트 셸(index.html)을 그 URL 에서 바로 200 으로 내고 <head> 머리에 history.replaceState('/#<경로>') 를 넣어
// 기존 해시 라우터가 그대로 처리한다(딥링크 형식 검증은 index.html _pageFromHash). /show/<id>·/meet/<id>·/band/times 와 같은 방식.
// /shows/<uuid>·/community/meeting/<uuid> 는 공연·모임 공유 함수에 맡겨 포스터·대표 이미지 OG 까지 같게 낸다.
// 셸을 못 읽으면(ASSETS 없음) next() — 정적 SPA 폴백 + index.html 머리 스크립트가 같은 치환을 한다.
export const APP_SECTIONS = ['gatheo', 'band', 'band-news', 'community', 'perf', 'shows', 'host'];
const SITE = 'https://gatherallaround.com';
const ROUTE_SEG_RE = /^[A-Za-z0-9_-]{1,64}$/;   // 스크립트 문자열에 그대로 들어가므로 안전한 글자만(아니면 섹션까지로 절단)

export function appRouteFromPath(pathname) {
    const segs = String(pathname || '').split('/').filter(Boolean);
    if (!segs.length) return null;
    const head = segs[0].toLowerCase();
    if (!APP_SECTIONS.includes(head)) return null;
    const rest = segs.slice(1, 4);
    if (segs.length > 4 || !rest.every(s => ROUTE_SEG_RE.test(s))) return head;
    return [head, ...rest].join('/');
}

// 섹션별 링크 미리보기(크롤러용 og:title·description·url). 이미지는 포털 기본 그대로.
const SECTION_OG = {
    perf: ['공간 대관 | Gather all around', '신촌 5분 거리 합주·공연 공간 — 대관 가능일을 확인하고 바로 예약하세요.'],
    shows: ['공연 예매 | Gather all around', '게더 올 어라운드에서 열리는 공연을 예매하세요.'],
    community: ['커뮤니티 | Gather all around', '게더 올 어라운드 커뮤니티 모임에 참여해 보세요.'],
    'band/times': ['고정 합주팀 가능 시간 | Gather all around', '매주 같은 시간, 4주 단위로 쓰는 고정 합주팀 — 지금 신청할 수 있는 시간을 확인하세요.'],
    'band/guide': ['고정 합주팀 운영 안내 | Gather all around', '가입·회차·이용료·캐비넷·건너뛰기권 — 고정 합주팀 운영 방식을 한 곳에 모았어요.'],
    band: ['고정 합주팀 | Gather all around', '매주 같은 시간, 4주 단위로 쓰는 고정 합주팀 — 가능 시간 확인·가입 신청.'],
    'band-news': ['어제 하루, 밴드씬에서 생긴 일?! | Gather all around', '국내외 밴드씬 이슈를 한 번에 읽어보자'],
    host: ['호스트 센터 | Gather all around', '공연 등록·예매 관리'],
    gatheo: ['게더링 | Gather all around', '게더링 멤버 전용 페이지'],
};
function sectionOg(route) {
    const segs = route.split('/');
    return SECTION_OG[segs.slice(0, 2).join('/')] || SECTION_OG[segs[0]] || null;
}

export function appShellWithRoute(html, route) {
    // <base> 는 넣지 않는다 — 셸 자산은 모두 절대 경로라 필요 없고, 넣으면 이후 '#…' 상대 replaceState 가 쿼리를 떨군다(정적 폴백과 동작을 맞춤).
    const head = `<head>\n    <script>try{history.replaceState(null,'','/'+location.search+'#${route}')}catch(e){}</script>`;
    html = html.replace(/<head>/i, head);
    const og = sectionOg(route);
    if (!og) return html;
    return html
        .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${escapeAttr(og[0])}">`)
        .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${escapeAttr(og[1])}">`)
        .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${escapeAttr(SITE + '/' + route)}">`);
}

async function rootShell(context) {
    const { request, env } = context;
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
    try {
        const r = await env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), { headers: { accept: 'text/html' } }));
        if (!r || !r.ok) return null;
        const html = await r.text();
        return /<title>Gather all around/.test(html) ? html : null; // 포털 셸이 아니면 쓰지 않는다
    } catch (_) { return null; }
}

async function appRouteResponse(context, route) {
    const share = /^(shows|community\/meeting)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(route);
    if (share) {   // 공연·모임 상세 — 공유 함수와 같은 응답(크롤러엔 포스터 OG, 사람엔 상세로 가는 셸)
        const ctx = { ...context, params: { id: share[2].toLowerCase() } };
        return share[1] === 'shows' ? showShare(ctx) : meetShare(ctx);
    }
    const shell = await rootShell(context);
    if (!shell) return context.next();
    return new Response(appShellWithRoute(shell, route), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Drive API 키는 Cloudflare 환경변수(DRIVE_API_KEY)에서 읽는다.
// 미설정 시 기존 하드코딩 값으로 폴백(하위호환). 설정 후 이 폴백 값은 콘솔에서 폐기/제한 권장.
const DRIVE_API_KEY_FALLBACK = 'AIzaSyDk7iyY1XU0mepXOOqwY6h5YitbHHg6t40';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAPPEN_SHARE = 'https://gatherallaround.com';   // og:url — 재공유돼도 표준 형태(/wp/<id> · /ww/<id>) 유지

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// 와펜 공유 요청의 (작품 id, 프로젝트 id) — 루트는 wp/ww, /wappen/ 은 예전 p/w 도 허용
function wappenShareIds(url) {
    const sp = url.searchParams;
    const root = /^\/(index\.html)?$/.test(url.pathname), sub = /^\/wappen\/?(index\.html)?$/.test(url.pathname);
    if (!root && !sub) return null;
    const w = sp.get('ww') || (sub ? sp.get('w') : null), p = sp.get('wp') || (sub ? sp.get('p') : null);
    if (UUID_RE.test(w || '')) return { w: w.toLowerCase() };
    if (UUID_RE.test(p || '')) return { p: p.toLowerCase() };
    return null;
}

// 와펜 공유 요청이면 OG 데이터를, 아니면 null. service role 로 1행만 읽는다(공개 상태만, PII 없음).
async function wappenOg(env, url) {
    const ids = wappenShareIds(url);
    if (!ids) return null;
    const w = ids.w, p = ids.p;
    if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
    const get = async (q) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers }); if (!r.ok) return null; const rows = await r.json().catch(() => null); return Array.isArray(rows) ? rows[0] || null : null; };
    if (w) {
        const id = w;
        const row = await get(`wappen_works?id=eq.${id}&status=eq.active&select=title,author_name,preview_url,preview_w,preview_h,wappen_projects(title,status)&limit=1`);
        if (!row || !row.preview_url) return null;
        const proj = row.wappen_projects && row.wappen_projects.status === 'active' ? row.wappen_projects.title : '';
        return { title: `${row.title} — ${row.author_name}님의 와펜 작품`, desc: `${proj ? proj + ' 프로젝트 · ' : ''}와펜을 붙여 꾸민 작품을 구경하고 반응을 남겨보세요`,
            image: row.preview_url, w: row.preview_w, h: row.preview_h, url: `${WAPPEN_SHARE}/ww/${id}` };
    }
    const id = p;
    const row = await get(`wappen_projects?id=eq.${id}&status=eq.active&select=title,author_name,description,thumb_url,base_image_url,works_count,width_px,height_px&limit=1`);
    if (!row) return null;
    return { title: `${row.title} — 포스터 꾸미기 프로젝트`, desc: row.description || `${row.author_name}님의 프로젝트 · 작품 ${row.works_count || 0}개 · 와펜을 붙여 나만의 작품을 만들어보세요`,
        image: row.thumb_url || row.base_image_url, w: null, h: null, url: `${WAPPEN_SHARE}/wp/${id}` };
}

// ── 보안 헤더(2026-11-09, 「보안이 널널하대」) ───────────────────────────────
// 모든 응답(정적 자산·섹션 셸·OG 페이지·302·Functions JSON)에 공통으로 붙인다. 원본이 이미 같은 이름의 헤더를 냈으면 그대로 둔다.
// _headers 파일에도 같은 값을 적어 두었다(이중 안전망 — Functions 응답엔 _headers 가 적용되지 않고, 정적 자산은 둘 다 거친다).
// CSP 는 단일 파일 SPA(인라인 스크립트·onclick 핸들러·CDN 라이브러리)라 'unsafe-inline'·'unsafe-eval' 을 허용한 느슨한 정책이다 —
// 그래도 http: 리소스(upgrade-insecure-requests)·플러그인(object-src)·<base> 탈취(base-uri)·다른 사이트의 iframe 삽입(frame-ancestors = 클릭재킹)은 막는다.
// wss: 는 Supabase Realtime, data:/blob: 는 QR·캔버스 미리보기·다운로드. 더 조이려면 인라인 스크립트를 파일로 빼고 nonce 를 써야 한다(index.html 전면 수정).
// X-Frame-Options 도 같이(옛 브라우저). Permissions-Policy: 카메라·마이크·위치는 사이트가 쓰지 않는다(QR 체크인은 폰 카메라 앱으로 링크를 연다).
export const SECURITY_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': "default-src 'self' https: wss: data: blob: 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
};
export function withSecurityHeaders(response) {
    if (!response || !response.headers) return response;
    const missing = Object.entries(SECURITY_HEADERS).filter(([k]) => !response.headers.has(k));
    if (!missing.length) return response;
    const out = new Response(response.body, response); // ASSETS/next() 응답은 헤더가 불변이라 복제해서 붙인다
    missing.forEach(([k, v]) => out.headers.set(k, v));
    return out;
}
export async function onRequest(context) {
    return withSecurityHeaders(await handle(context));
}

async function handle(context) {
    const { request, next, env } = context;
    const DRIVE_API_KEY = (env && env.DRIVE_API_KEY) || DRIVE_API_KEY_FALLBACK;
    const url = new URL(request.url);
    const newsId = url.searchParams.get('news');
    if (!newsId && (request.method === 'GET' || request.method === 'HEAD')) {
        const route = appRouteFromPath(url.pathname);
        if (route) return appRouteResponse(context, route);
    }
    const wappenIds = newsId ? null : wappenShareIds(url);
    const wappenShare = !!wappenIds;
    if (wappenShare && !isCrawler(request)) {   // 경로형 공유 URL 로 보낸다 — 거기서 셸이 바로 나온다(해시·쿼리 없음)
        const target = wappenIds.w ? `/ww/${wappenIds.w}` : `/wp/${wappenIds.p}`;
        return new Response(null, { status: 302, headers: { Location: new URL(target, request.url).toString(), 'Cache-Control': 'no-store' } });
    }

    const response = await next();

    if (!newsId && !wappenShare) return response;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    if (wappenShare) {
        let og = null;
        try { og = await wappenOg(env, url); } catch (e) { og = null; }
        if (!og) return response;
        const html = injectOg(await response.text(), og);
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'no-store');
        return new Response(html, { status: response.status, statusText: response.statusText, headers });
    }

    // Drive에서 파일명 가져오기
    let title = '밴드씬 뉴스';
    try {
        const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(newsId)}?fields=name&key=${DRIVE_API_KEY}`);
        if (metaRes.ok) {
            const meta = await metaRes.json();
            const name = (meta.name || '').replace(/\.html?$/i, '').trim();
            if (name) title = name;
        }
    } catch (e) {}

    const ogTitle = `${title} | 어제 하루, 밴드씬에서 생긴 일?!`;
    const ogDesc = '국내외 밴드씬 이슈를 한 번에 읽어보자';

    let html = await response.text();
    html = html
        .replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(ogTitle)}</title>`)
        .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${escapeAttr(ogTitle)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${escapeAttr(ogDesc)}">`);

    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');

    return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
