// /meet/<모임 id> — 커뮤니티 모임 상세 공유 링크 (Cloudflare Pages Function)
//
// 왜 경로형인가(2026-10-27): 인스타그램 프로필 링크·카카오톡 등 인앱 브라우저는 URL 의 #해시를 버린다.
// `#community/meeting/<id>` 를 그대로 걸어 두면 포털 루트에서 멈추고, 크롤러도 해시 뒤를 못 봐 미리보기가 포털 기본으로 뜬다.
// 공연 예매 /show/<id>(functions/show/[id].js) 와 같은 방식:
//  · 크롤러: 모임 제목·일시·장소·참여비 + 대표 이미지를 OG 로 담은 200 HTML(즉시 이동 스크립트 포함)
//  · 사람: 루트 index.html 을 이 URL 에서 바로 200 으로 — <base href="/"> + history.replaceState('/#community/meeting/<id>') 를 <head> 머리에.
//    셸을 못 읽으면 302 /#community/meeting/<id> 폴백.
//  · 모임 행은 service role 로 1건만(공개 정보만; pending/rejected 는 기본 OG). env 없으면 기본 OG.
import { isCrawler } from '../../wappen/share-page.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = 'https://gatherallaround.com';
const DEFAULT_IMAGE = `${SITE}/icon.jpg`;
const DEFAULT_TITLE = '커뮤니티 | Gather all around';
const DEFAULT_DESC = '게더 올 어라운드 커뮤니티 모임에 참여해 보세요.';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const appHash = (id) => `/#community/meeting/${id}`;
export const sharePath = (id) => `/meet/${id}`;

// "2026-11-21" + "17:00" → "11/21(토) 17:00" (meeting_date 는 날짜 문자열이라 시간대 변환 없음)
export function meetDateStr(date, time) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
    const t = /^(\d{1,2}):(\d{2})/.exec(time || '');
    return `${+m[2]}/${+m[3]}(${wd})${t ? ' ' + t[1].padStart(2, '0') + ':' + t[2] : ''}`;
}

export async function meetOg(env, id) {
    if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    let row = null;
    try {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/community_meetings?id=eq.${id}&select=title,meeting_date,meeting_time,location,fee,cover_image_url,organizer_name,status&limit=1`,
            { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
        if (!r.ok) return null;
        const rows = await r.json().catch(() => null);
        row = Array.isArray(rows) ? rows[0] || null : null;
    } catch (_) { return null; }
    if (!row || !row.title || (row.status || 'active') !== 'active') return null;
    const parts = [meetDateStr(row.meeting_date, row.meeting_time), row.location, row.organizer_name].filter(Boolean);
    const fee = row.fee > 0 ? `₩${Number(row.fee).toLocaleString('ko-KR')}` : '무료';
    return {
        title: String(row.title),
        desc: `${parts.join(' · ')}${parts.length ? ' · ' : ''}${fee} — 커뮤니티 모임`,
        image: row.cover_image_url || DEFAULT_IMAGE,
        hasCover: !!row.cover_image_url,
        url: SITE + sharePath(id),
    };
}

export function injectMeetOg(html, og) {
    html = html
        .replace(/<title>[^<]*<\/title>/i, `<title>${esc(og.title)} | 커뮤니티</title>`)
        .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${esc(og.title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${esc(og.desc)}">`)
        .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${esc(og.image)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${esc(og.url)}">`)
        .replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${esc(og.image)}">`);
    if (og.hasCover) html = html.replace(/\s*<meta property="og:image:(width|height)" content="[^"]*">/gi, '');
    return html;
}

export function shellWithRoute(html, id, og) {
    const head = `<head>\n    <base href="/">\n    <script>try{history.replaceState({page:'community/meeting/${id}'},'','${appHash(id)}')}catch(e){}</script>`;
    html = html.replace(/<head>/i, head);
    return og ? injectMeetOg(html, og) : html;
}

export function crawlerPageHTML(id, og) {
    const target = appHash(id), url = SITE + sharePath(id);
    const title = og ? og.title : DEFAULT_TITLE, desc = og ? og.desc : DEFAULT_DESC, image = og ? og.image : DEFAULT_IMAGE;
    const dims = og && og.hasCover ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">';
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}${og ? ' | 커뮤니티' : ''}</title>
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
<body><div><p>모임 페이지로 이동 중…</p><a href="${esc(target)}">바로 가기</a></div></body>
</html>`;
}

async function rootShell(context) {
    const { request, env } = context;
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
    try {
        const r = await env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), { headers: { accept: 'text/html' } }));
        if (!r || !r.ok) return null;
        const html = await r.text();
        return /<title>Gather all around/.test(html) ? html : null;
    } catch (_) { return null; }
}

const redirectTo = (request, path) => new Response(null, { status: 302, headers: { Location: new URL(path, request.url).toString(), 'Cache-Control': 'no-store' } });

export async function onRequest(context) {
    const { request, env, params } = context;
    const id = String((params && params.id) || '').toLowerCase();
    if (!UUID_RE.test(id)) return redirectTo(request, '/#community');
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
    const ogP = meetOg(env, id).catch(() => null);
    if (!isCrawler(request)) {
        const [og, shell] = await Promise.all([ogP, rootShell(context)]);
        if (shell) return new Response(shellWithRoute(shell, id, og), { status: 200, headers });
        return redirectTo(request, appHash(id));
    }
    return new Response(crawlerPageHTML(id, await ogP), { status: 200, headers });
}
