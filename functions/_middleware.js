// Cloudflare Pages middleware
// ?news=<fileId> 요청에 대해 Drive에서 기사 제목을 가져와 OG 태그를 동적으로 주입.
// 메신저 크롤러(KakaoTalk, Facebook 등)가 정적 HTML을 읽을 때 기사별 미리보기가 표시됨.

const DRIVE_API_KEY = 'AIzaSyDk7iyY1XU0mepXOOqwY6h5YitbHHg6t40';

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);
    const newsId = url.searchParams.get('news');

    const response = await next();

    if (!newsId) return response;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

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
