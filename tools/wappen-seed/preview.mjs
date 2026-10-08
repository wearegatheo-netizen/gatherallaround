// 선택한 디자인만 Chromium 으로 렌더해 미리보기 시트를 만든다 — wappen/seed·manifest 는 건드리지 않는다(검토용).
// 실행: NODE_PATH=<scratchpad>/node_modules node tools/wappen-seed/preview.mjs --only e-a,e-b --out <dir> --sheet <png>
import { DESIGNS, EMB_PARTS } from './designs.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = (argOf('--only', '') || '').split(',').filter(Boolean);
const outDir = path.resolve(argOf('--out', path.join('/tmp', 'wappen-preview'))), sheet = argOf('--sheet', '');
mkdirSync(outDir, { recursive: true });
const masks = args.includes('--masks');   // 자수 시뮬레이션용: EMB_PARTS 의 부품별 마스크(흰 실루엣, 2048px) + parts.json
const list = masks ? EMB_PARTS.filter(d => !only.length || only.includes(d.key)) : (only.length ? DESIGNS.filter(d => only.includes(d.key)) : DESIGNS);
if (!list.length) { console.error('no designs'); process.exit(1); }

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
const ttf = readFileSync(path.join(repo, 'BMKkubulimTTF.ttf'));
await page.route('http://seed.local/**', (route) => route.fulfill({ status: 200, contentType: 'font/ttf', body: ttf }));
const meta = [];
if (masks) {
    const page2 = await browser.newPage({ viewport: { width: 2100, height: 2100 }, deviceScaleFactor: 1 });
    for (const d of list) {
        const dir = path.join(outDir, d.key); mkdirSync(dir, { recursive: true });
        const parts = [];
        for (let i = 0; i < d.parts.length; i++) {
            const pt = d.parts[i];
            const tf = pt.rot ? `transform="rotate(${pt.rot} 500 500)"` : '';
            const body = pt.text ? `<text x="${pt.x}" y="${pt.y}" ${tf} text-anchor="middle" font-family="'Inter','Arial Black','Helvetica Neue',Arial,sans-serif" font-weight="900" font-size="${pt.size}" letter-spacing="${pt.ls || 0}" fill="#fff">${pt.text}</text>`
                : `<path d="${pt.d}" ${tf} fill="#fff"/>`;
            await page2.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:2048px;height:2048px}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${body}</svg></body></html>`);
            await page2.evaluate(() => document.fonts.ready);
            const el = await page2.$('svg');
            writeFileSync(path.join(dir, `mask-${i}.png`), await el.screenshot({ omitBackground: true, type: 'png' }));
            parts.push({ i, fill: pt.fill, angle: pt.angle || 0, outline: pt.outline !== false, text: !!pt.text });
        }
        writeFileSync(path.join(dir, 'parts.json'), JSON.stringify({ key: d.key, name: d.name, category: d.category, tags: d.tags, border: d.border, parts }));
        meta.push({ key: d.key, name: d.name, category: d.category, tags: d.tags });
        process.stdout.write(`masks ${d.key} (${parts.length})\n`);
    }
    await browser.close();
    writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta));
    process.exit(0);
}
for (const d of list) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @font-face { font-family: 'KkuBulLim'; src: url('http://seed.local/kkubulim.ttf') format('truetype'); }
        html, body { margin: 0; background: transparent; } svg { display: block; width: 1024px; height: 1024px; }
        </style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${d.svg}</svg></body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const el = await page.$('svg');
    writeFileSync(path.join(outDir, d.key + '.png'), await el.screenshot({ omitBackground: true, type: 'png' }));
    meta.push({ key: d.key, name: d.name, category: d.category, tags: d.tags });
    process.stdout.write(`rendered ${d.key}\n`);
}
await browser.close();
writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta));
if (sheet) { const py = spawnSync('python3', ['-I', path.join(here, 'sheet.py'), outDir, sheet], { stdio: 'inherit' }); process.exit(py.status || 0); }
