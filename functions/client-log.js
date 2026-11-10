// Cloudflare Pages Function: /client-log
// 방문자 브라우저에서 난 스크립트 오류를 받아 client_errors 표에 남긴다 (service role).
// 배경(2026-11-10): 사용자 폰에서 난 오류를 알 길이 없어 제보에만 의존했다. index.html 이 window error·unhandledrejection 을
// 세션당 몇 건만(같은 메시지는 한 번) 보내고, 운영 총괄이 관리자 › 운영 도구에서 본다(/gatheo-api client_errors).
// 개인정보를 받지 않는다: 메시지·스택·화면 경로·브라우저 종류만. 주소의 쿼리·토큰은 브라우저가 지우고 보낸다.
// 표가 아직 없으면(마이그레이션 20261110_client_errors.sql 전) 조용히 버린다(Cloudflare 로그에만).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }
const isOurHost = (h) => h === 'gatherallaround.com' || h === 'localhost' || h === '127.0.0.1' || /\.(gatherallaround\.com|pages\.dev)$/.test(h);
function fromOurSite(request) {
    const sfs = request.headers.get('Sec-Fetch-Site');
    if (sfs === 'same-origin' || sfs === 'same-site') return true;
    return isOurHost(hostOf(request.headers.get('Origin') || '')) || isOurHost(hostOf(request.headers.get('Referer') || ''));
}
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
// 혹시 섞여 들어온 전화번호·이메일·긴 토큰은 가린다
export const scrub = (s) => String(s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, '[phone]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[token]');

export function cleanEntry(e, ua) {
    if (!e || typeof e !== 'object') return null;
    const message = scrub(clip(e.message, 500)).trim();
    if (!message) return null;
    return {
        message,
        stack: scrub(clip(e.stack, 3000)) || null,
        page: scrub(clip(e.page, 120)) || null,       // 예: gatheo/reservation
        source: scrub(clip(e.source, 200)) || null,   // 파일:줄:칸
        kind: ['error', 'promise'].includes(e.kind) ? e.kind : 'error',
        role: ['member', 'admin', 'band', 'guest'].includes(e.role) ? e.role : 'guest',
        ua: clip(ua, 300) || null,
    };
}

export async function onRequestPost({ request, env }) {
    const done = (status = 204) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!fromOurSite(request)) return done(403);
    let body;
    try { const text = await request.text(); if (text.length > 20000) return done(413); body = JSON.parse(text); } catch (_) { return done(400); }
    const rows = (Array.isArray(body && body.errors) ? body.errors : []).slice(0, 5).map(e => cleanEntry(e, request.headers.get('User-Agent'))).filter(Boolean);
    if (!rows.length) return done();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('client-error:', JSON.stringify(rows)); return done(); }
    try {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/client_errors`, {
            method: 'POST',
            headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify(rows),
        });
        if (!r.ok) console.error('client-error(표 없음?):', r.status, JSON.stringify(rows).slice(0, 2000));
    } catch (e) { console.error('client-error store failed:', e && e.message); }
    return done();
}
