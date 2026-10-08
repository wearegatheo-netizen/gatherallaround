// 선택한 디자인만 Chromium 으로 렌더해 미리보기 시트를 만든다 — wappen/seed·manifest 는 건드리지 않는다(검토용).
// 실행: NODE_PATH=<scratchpad>/node_modules node tools/wappen-seed/preview.mjs --only e-a,e-b --out <dir> --sheet <png>
import { DESIGNS } from './designs.mjs';
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
const list = only.length ? DESIGNS.filter(d => only.includes(d.key)) : DESIGNS;
if (!list.length) { console.error('no designs'); process.exit(1); }

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
const ttf = readFileSync(path.join(repo, 'BMKkubulimTTF.ttf'));
await page.route('http://seed.local/**', (route) => route.fulfill({ status: 200, contentType: 'font/ttf', body: ttf }));
const meta = [];
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
