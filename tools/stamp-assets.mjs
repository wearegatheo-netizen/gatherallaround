// index.html 이 읽는 우리 파일(/js/app-*.js · /css/app.css · /shared/rules.js)의 ?v= 를 파일 내용 해시로 갱신한다.
// 파일을 고친 뒤 항상 실행:  node tools/stamp-assets.mjs      (검사만: node tools/stamp-assets.mjs --check)
// 이유: 카톡 인앱 브라우저 등이 주소가 같은 파일을 오래 붙잡는다 — 내용이 바뀌면 주소(?v=)도 바뀌어야 새 코드를 받는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const RE = /((?:src|href)=")(\/(?:js\/app-[\w-]+\.js|css\/app\.css|shared\/rules\.js))\?v=([\w]*)(")/g;
export function stamp(html) {
    let stale = 0; const files = [];
    const out = html.replace(RE, (m, pre, path, v, post) => {
        const hash = createHash('sha256').update(readFileSync(new URL('.' + path, root))).digest('hex').slice(0, 8);
        files.push(path); if (hash !== v) stale++;
        return `${pre}${path}?v=${hash}${post}`;
    });
    return { out, stale, files };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const p = new URL('index.html', root), html = readFileSync(p, 'utf8');
    const { out, stale, files } = stamp(html);
    if (process.argv.includes('--check')) { console.log(stale ? `갱신 필요: ${stale}개 (node tools/stamp-assets.mjs)` : `최신 (${files.length}개)`); process.exit(stale ? 1 : 0); }
    if (stale) writeFileSync(p, out);
    console.log(stale ? `?v= ${stale}개 갱신` : `변경 없음 (${files.length}개)`);
}
