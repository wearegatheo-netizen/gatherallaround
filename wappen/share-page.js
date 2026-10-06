// 와펜 공유 링크 페이지 — /wp/<프로젝트 id> · /ww/<작품 id> (Cloudflare Pages Function 이 import).
// 경로 기반이라 쿼리·해시가 깎여도 살아남고, 정적 자산 폴백(404 → 루트 index.html)의 영향을 받지 않는다.
// 응답은 200 HTML: 크롤러(카카오톡 스크랩 등)는 OG 태그를 읽고, 사람은 즉시 /wappen/#/… 로 넘어간다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = 'https://gatherallaround.com';
// 링크 미리보기 크롤러(카카오톡 kakaotalk-scrap, 페이스북, 트위터, 슬랙, 디스코드, 텔레그램, 라인, 네이버 Yeti, 구글 등) 와 curl 류 도구.
// 사람이 쓰는 카카오톡 인앱 브라우저 UA 는 "KAKAOTALK 10.x" 라 여기 안 걸린다(kakaotalk-scrap 만). UA 가 비면 크롤러로 본다.
export const BOT_RE = /bot|crawl|spider|scrap|preview|facebookexternalhit|facebookcatalog|Twitterbot|Slackbot|Discordbot|TelegramBot|WhatsApp|LinkedInBot|Pinterest|Embedly|Iframely|vkShare|Daumoa|Yeti|Applebot|bingbot|Googlebot|curl|wget|python-requests|Go-http-client|okhttp/i;
export function isCrawler(request) {
    const ua = (request && request.headers && request.headers.get('user-agent')) || '';
    return !ua || BOT_RE.test(ua);
}
const DEFAULT_IMAGE = `${SITE}/icon.jpg`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function fetchRow(env, pathQuery) {
    if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    try {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathQuery}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
        if (!r.ok) return null;
        const rows = await r.json().catch(() => null);
        return Array.isArray(rows) ? rows[0] || null : null;
    } catch (_) { return null; }
}

// kind: 'project' | 'work'
export async function shareOg(env, kind, id) {
    const url = SITE + sharePath(kind, id);
    if (kind === 'work') {
        const row = await fetchRow(env, `wappen_works?id=eq.${id}&status=eq.active&select=title,author_name,preview_url,preview_w,preview_h,wappen_projects(title,status)&limit=1`);
        if (!row) return null;
        const proj = row.wappen_projects && row.wappen_projects.status === 'active' ? row.wappen_projects.title : '';
        return { title: `${row.title} — ${row.author_name}님의 와펜 작품`, desc: `${proj ? proj + ' 프로젝트 · ' : ''}와펜을 붙여 꾸민 작품을 구경하고 반응을 남겨보세요`,
            image: row.preview_url || DEFAULT_IMAGE, w: row.preview_w, h: row.preview_h, url };
    }
    const row = await fetchRow(env, `wappen_projects?id=eq.${id}&status=eq.active&select=title,author_name,description,thumb_url,base_image_url,works_count&limit=1`);
    if (!row) return null;
    return { title: `${row.title} — 와펜 꾸미기 프로젝트`, desc: row.description || `${row.author_name}님의 프로젝트 · 작품 ${row.works_count || 0}개 · 와펜을 붙여 나만의 작품을 만들어보세요`,
        image: row.thumb_url || row.base_image_url || DEFAULT_IMAGE, w: null, h: null, url };
}

// HTML(와펜 셸·루트 포털)의 <title>·og:*·twitter:image 를 작품/프로젝트 값으로 치환 — 미들웨어와 공유 함수가 공용 (속성 순서·형식은 wappen/index.html 과 동일해야 함)
export function injectOg(html, og) {
    html = html
        .replace(/<title>[^<]*<\/title>/i, `<title>${esc(og.title)} | 와펜 꾸미기</title>`)
        .replace(/<meta name="description" content="[^"]*">/i, `<meta name="description" content="${esc(og.desc)}">`)
        .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${esc(og.title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${esc(og.desc)}">`)
        .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${esc(og.image)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${esc(og.url)}">`)
        .replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${esc(og.image)}">`);
    if (og.w && og.h) {
        html = html
            .replace(/<meta property="og:image:width" content="[^"]*">/i, `<meta property="og:image:width" content="${og.w}">`)
            .replace(/<meta property="og:image:height" content="[^"]*">/i, `<meta property="og:image:height" content="${og.h}">`);
    } else {
        html = html.replace(/\s*<meta property="og:image:(width|height)" content="[^"]*">/gi, '');
    }
    return html;
}

// 사람(브라우저)에게 줄 와펜 셸 — /wappen/ 의 index.html 을 정적 자산에서 읽어 <base href="/wappen/"> 를 넣는다.
// 그래서 /wp/<id> 자체가 앱 페이지가 된다(리다이렉트·해시·쿼리 없음 → 인앱 브라우저가 깎을 것이 없음). app.js boot() 가 경로를 읽어 해시 라우트로 바꾼다.
// 상대 자산(./style.css·./app.js)은 base 덕에 /wappen/ 기준으로 풀린다. 정적 자산을 못 읽으면 null(호출측이 302 폴백).
export async function appShellHTML(context, og) {
    const { request, env } = context;
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
    const r = await env.ASSETS.fetch(new Request(new URL('/wappen/', request.url).toString(), { headers: { accept: 'text/html' } }));
    if (!r || !r.ok) return null;
    let html = await r.text();
    if (!/<title>와펜 꾸미기/.test(html)) return null;              // 폴백(포털 HTML 등)이 오면 쓰지 않는다
    if (!/<base\s/i.test(html)) html = html.replace(/<head>/i, '<head>\n    <base href="/wappen/">');
    return og ? injectOg(html, og) : html;
}

export function sharePath(kind, id) { return `/${kind === 'work' ? 'ww' : 'wp'}/${id}`; }
export function appHash(kind, id) { return `/wappen/#/${kind === 'work' ? 'work' : 'project'}/${id}`; }

export function sharePageHTML(kind, id, og) {
    const target = appHash(kind, id), url = SITE + sharePath(kind, id);
    const title = og ? og.title : '와펜 꾸미기 | Gather all around';
    const desc = og ? og.desc : '기본 이미지 위에 와펜을 붙여 나만의 포스터·SNS 이미지를 만들고 공유해보세요.';
    const image = og ? og.image : DEFAULT_IMAGE;
    const dims = og && og.w && og.h ? `<meta property="og:image:width" content="${og.w}"><meta property="og:image:height" content="${og.h}">` : (og ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} | 와펜 꾸미기</title>
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
<body><div><p>와펜 꾸미기로 이동 중…</p><a href="${esc(target)}">바로 가기</a></div></body>
</html>`;
}

// 사람(브라우저)은 HTTP 302 로 앱 해시 라우트에 바로 보낸다 — JS·HTML 파싱에 의존하지 않아 인앱 브라우저에서도 확실.
// Location 의 #fragment 는 브라우저가 그대로 따라간다.
export function redirectTo(request, path) {
    return new Response(null, { status: 302, headers: { Location: new URL(path, request.url).toString(), 'Cache-Control': 'no-store' } });
}

// Pages Function 본체 — functions/wp/[id].js · functions/ww/[id].js 가 kind 만 넣어 호출
//   크롤러 → OG 태그가 든 200 HTML(즉시 이동 스크립트·meta refresh·링크 포함)
//   사람 → 와펜 셸을 이 URL 에서 바로 200 으로(appShellHTML; 2026-10-07 — 302+해시는 인앱 브라우저가 #fragment 를 버릴 수 있어 폐기), 셸을 못 읽으면 302 폴백
export async function handleShare(context, kind) {
    const { request, env, params } = context;
    const id = String((params && params.id) || '').toLowerCase();
    if (!UUID_RE.test(id)) return redirectTo(request, '/wappen/');
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
    const ogP = shareOg(env, kind, id).catch(() => null);
    if (!isCrawler(request)) {
        const [og, shell] = await Promise.all([ogP, appShellHTML(context, null).catch(() => null)]);
        if (shell) return new Response(og ? injectOg(shell, og) : shell, { status: 200, headers });
        return redirectTo(request, appHash(kind, id));
    }
    return new Response(sharePageHTML(kind, id, await ogP), { status: 200, headers });
}
