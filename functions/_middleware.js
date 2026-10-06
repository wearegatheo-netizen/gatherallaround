// Cloudflare Pages middleware
// ?news=<fileId> 요청에 대해 Drive에서 기사 제목을 가져와 OG 태그를 동적으로 주입.
// 메신저 크롤러(KakaoTalk, Facebook 등)가 정적 HTML을 읽을 때 기사별 미리보기가 표시됨.
// /wappen/?w=<작품 id> · /wappen/?p=<프로젝트 id> 요청에는 와펜 꾸미기 작품·프로젝트별 OG 태그를 주입
// (해시 라우트는 크롤러가 못 보므로 공유 링크는 쿼리로 들어온다 — wappen/app.js 가 로드 시 해시로 치환).

// Drive API 키는 Cloudflare 환경변수(DRIVE_API_KEY)에서 읽는다.
// 미설정 시 기존 하드코딩 값으로 폴백(하위호환). 설정 후 이 폴백 값은 콘솔에서 폐기/제한 권장.
const DRIVE_API_KEY_FALLBACK = 'AIzaSyDk7iyY1XU0mepXOOqwY6h5YitbHHg6t40';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAPPEN_SITE = 'https://gatherallaround.com/wappen/';

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// 와펜 공유 요청이면 OG 데이터를, 아니면 null. service role 로 1행만 읽는다(공개 상태만, PII 없음).
async function wappenOg(env, url) {
    if (!/^\/wappen\/?(index\.html)?$/.test(url.pathname)) return null;
    const w = url.searchParams.get('w'), p = url.searchParams.get('p');
    if (!UUID_RE.test(w || '') && !UUID_RE.test(p || '')) return null;
    if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
    const get = async (q) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers }); if (!r.ok) return null; const rows = await r.json().catch(() => null); return Array.isArray(rows) ? rows[0] || null : null; };
    if (UUID_RE.test(w || '')) {
        const id = w.toLowerCase();
        const row = await get(`wappen_works?id=eq.${id}&status=eq.active&select=title,author_name,preview_url,preview_w,preview_h,wappen_projects(title,status)&limit=1`);
        if (!row || !row.preview_url) return null;
        const proj = row.wappen_projects && row.wappen_projects.status === 'active' ? row.wappen_projects.title : '';
        return { title: `${row.title} — ${row.author_name}님의 와펜 작품`, desc: `${proj ? proj + ' 프로젝트 · ' : ''}와펜을 붙여 꾸민 작품을 구경하고 반응을 남겨보세요`,
            image: row.preview_url, w: row.preview_w, h: row.preview_h, url: `${WAPPEN_SITE}?w=${id}` };
    }
    const id = p.toLowerCase();
    const row = await get(`wappen_projects?id=eq.${id}&status=eq.active&select=title,author_name,description,thumb_url,base_image_url,works_count,width_px,height_px&limit=1`);
    if (!row) return null;
    return { title: `${row.title} — 와펜 꾸미기 프로젝트`, desc: row.description || `${row.author_name}님의 프로젝트 · 작품 ${row.works_count || 0}개 · 와펜을 붙여 나만의 작품을 만들어보세요`,
        image: row.thumb_url || row.base_image_url, w: null, h: null, url: `${WAPPEN_SITE}?p=${id}` };
}

export async function onRequest(context) {
    const { request, next, env } = context;
    const DRIVE_API_KEY = (env && env.DRIVE_API_KEY) || DRIVE_API_KEY_FALLBACK;
    const url = new URL(request.url);
    const newsId = url.searchParams.get('news');
    const wappenShare = url.pathname.startsWith('/wappen') && (url.searchParams.has('w') || url.searchParams.has('p'));

    const response = await next();

    if (!newsId && !wappenShare) return response;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    if (wappenShare) {
        let og = null;
        try { og = await wappenOg(env, url); } catch (e) { og = null; }
        if (!og) return response;
        let html = await response.text();
        html = html
            .replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(og.title)} | 와펜 꾸미기</title>`)
            .replace(/<meta name="description" content="[^"]*">/i, `<meta name="description" content="${escapeAttr(og.desc)}">`)
            .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${escapeAttr(og.title)}">`)
            .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${escapeAttr(og.desc)}">`)
            .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${escapeAttr(og.image)}">`)
            .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${escapeAttr(og.url)}">`)
            .replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${escapeAttr(og.image)}">`);
        if (og.w && og.h) {
            html = html
                .replace(/<meta property="og:image:width" content="[^"]*">/i, `<meta property="og:image:width" content="${og.w}">`)
                .replace(/<meta property="og:image:height" content="[^"]*">/i, `<meta property="og:image:height" content="${og.h}">`);
        } else {
            html = html.replace(/\s*<meta property="og:image:(width|height)" content="[^"]*">/gi, '');
        }
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
