// /show/<공연 id> — 공연 예매 상세 공유 링크 (Cloudflare Pages Function)
//
// 왜 경로형인가: 카카오톡 등 메신저는 URL 의 #해시를 버리거나 스크랩 크롤러가 해시 뒤를 못 보므로
// `#shows/<id>` 를 그대로 공유하면 미리보기가 포털 기본 이미지로 뜨고 인앱에서 포털에 멈추기도 한다.
// (와펜 꾸미기 /ww/·/wp/ 와 같은 방식 — wappen/share-page.js 참고)
//
//  · 크롤러(kakaotalk-scrap 등): 공연 제목·일시·장소·주최 + **포스터**를 OG 로 담은 200 HTML(즉시 이동 스크립트 포함)
//  · 사람(브라우저): 루트 index.html(정적 자산)을 이 URL 에서 바로 200 으로 내준다 — <base href="/"> 와
//    history.replaceState('/#shows/<id>') 를 <head> 머리에 넣어 SPA 부팅이 상세 화면으로 라우팅한다(302+해시 없음, 인앱 안전).
//    셸을 못 읽으면 302 /#shows/<id> 폴백.
//  · 공연 행은 service role 로 1건만 읽는다(공개 정보만, 숨김 상태는 기본 OG). env 없으면 기본 OG.
import { isCrawler } from '../../wappen/share-page.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = 'https://gatherallaround.com';
const DEFAULT_IMAGE = `${SITE}/icon.jpg`;
const DEFAULT_TITLE = '공연 예매 | Gather all around';
const DEFAULT_DESC = '게더 올 어라운드에서 열리는 공연을 예매하세요.';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const appHash = (id) => `/#shows/${id}`;
export const sharePath = (id) => `/show/${id}`;

// KST 기준 "10/18(토) 19:00" — index.html _showDateStr 과 같은 표기(서버는 UTC 라 +9h 로 계산)
export function showDateStr(iso) {
    const t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    const d = new Date(t + 9 * 3600e3);
    const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd}) ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export async function showOg(env, id) {
    if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    let row = null;
    try {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/events?id=eq.${id}&select=title,starts_at,venue,host_name,poster_url,status,price&limit=1`,
            { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
        if (!r.ok) return null;
        const rows = await r.json().catch(() => null);
        row = Array.isArray(rows) ? rows[0] || null : null;
    } catch (_) { return null; }
    if (!row || !row.title || row.status === 'hidden') return null;
    const parts = [showDateStr(row.starts_at), row.venue, row.host_name].filter(Boolean);
    const price = row.price > 0 ? `₩${Number(row.price).toLocaleString('ko-KR')}` : '무료';
    return {
        title: String(row.title),
        desc: `${parts.join(' · ')}${parts.length ? ' · ' : ''}${price} — 공연 예매`,
        image: row.poster_url || DEFAULT_IMAGE,
        hasPoster: !!row.poster_url,
        url: SITE + sharePath(id),
    };
}

// 루트 index.html 의 <title>·og:*·twitter:image 치환. 포스터는 크기를 모르므로 og:image:width/height 를 제거(기본 이미지는 1200×630 유지).
export function injectShowOg(html, og) {
    html = html
        .replace(/<title>[^<]*<\/title>/i, `<title>${esc(og.title)} | 공연 예매</title>`)
        .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${esc(og.title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${esc(og.desc)}">`)
        .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${esc(og.image)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${esc(og.url)}">`)
        .replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${esc(og.image)}">`);
    if (og.hasPoster) html = html.replace(/\s*<meta property="og:image:(width|height)" content="[^"]*">/gi, '');
    return html;
}

// 사람에게 줄 셸 — <head> 머리에 base 와 라우팅용 replaceState 를 넣는다(인라인 부팅 스크립트보다 먼저 실행).
export function shellWithRoute(html, id, og) {
    const head = `<head>\n    <base href="/">\n    <script>try{history.replaceState({page:'shows/${id}'},'','${appHash(id)}')}catch(e){}</script>`;
    html = html.replace(/<head>/i, head);
    return og ? injectShowOg(html, og) : html;
}

export function crawlerPageHTML(id, og) {
    const target = appHash(id), url = SITE + sharePath(id);
    const title = og ? og.title : DEFAULT_TITLE, desc = og ? og.desc : DEFAULT_DESC, image = og ? og.image : DEFAULT_IMAGE;
    const dims = og && og.hasPoster ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">';
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}${og ? ' | 공연 예매' : ''}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
${dims}
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#F4F5F8;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}a{display:inline-block;margin-top:14px;padding:12px 20px;border-radius:10px;background:#3366FF;color:#fff;text-decoration:none;font-weight:700}</style>
</head>
<body><div><p>공연 예매 페이지로 이동 중…</p><a href="${esc(target)}">바로 가기</a></div></body>
</html>`;
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

const redirectTo = (request, path) => new Response(null, { status: 302, headers: { Location: new URL(path, request.url).toString(), 'Cache-Control': 'no-store' } });

export async function onRequest(context) {
    const { request, env, params } = context;
    const id = String((params && params.id) || '').toLowerCase();
    if (!UUID_RE.test(id)) return redirectTo(request, '/#shows');
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
    const ogP = showOg(env, id).catch(() => null);
    if (!isCrawler(request)) {
        const [og, shell] = await Promise.all([ogP, rootShell(context)]);
        if (shell) return new Response(shellWithRoute(shell, id, og), { status: 200, headers });
        return redirectTo(request, appHash(id));
    }
    return new Response(crawlerPageHTML(id, await ogP), { status: 200, headers });
}
