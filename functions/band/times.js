// /band/times — 고정 합주팀 「고정 가능 시간 보기」 링크 (Cloudflare Pages Function, 2026-11-05)
//
// 가입 전에 일정부터 보는 화면(#band/times)을 인스타·카톡에 붙일 수 있게 경로형으로 낸다.
// 인앱 브라우저가 #해시를 버리므로 /show/<id>·/meet/<id> 와 같은 방식: 루트 index.html 을 이 URL 에서 바로 200 으로 내주고
// <base href="/"> + history.replaceState('/#band/times') 를 <head> 머리에 넣어 SPA 부팅이 시간표 화면으로 라우팅한다.
// 크롤러는 구분하지 않는다(OG 는 포털 기본값). 셸을 못 읽으면 302 /#band/times 폴백.
const APP_HASH = '/#band/times';

export function shellWithRoute(html) {
    const head = `<head>\n    <base href="/">\n    <script>try{history.replaceState({page:'band/times'},'','${APP_HASH}')}catch(e){}</script>`;
    return html.replace(/<head>/i, head);
}

async function fetchShell(env, request) {
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
    try {
        const r = await env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), { headers: { accept: 'text/html' } }));
        if (!r.ok) return null;
        const html = await r.text();
        return /<head>/i.test(html) ? html : null;
    } catch (_) { return null; }
}

export async function onRequest({ request, env }) {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
    const shell = await fetchShell(env, request);
    if (shell) return new Response(shellWithRoute(shell), { status: 200, headers });
    return Response.redirect(new URL(APP_HASH, request.url).toString(), 302);
}
