// 기본 와펜 세트 빌드: designs.mjs 의 SVG 를 Chromium 으로 투명 PNG 렌더 → finish.py 가 여백 자르기·최적화·manifest.js·미리보기 시트 생성.
// 실행: NODE_PATH=<scratchpad>/node_modules node tools/wappen-seed/build.mjs [--out <dir>] [--sheet <png>] [--raw <tmpdir>]
//   (Playwright 는 저장소에 없음 — scratchpad node_modules, Chromium 은 /opt/pw-browsers/chromium)
import { DESIGNS } from './designs.mjs';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = path.resolve(argOf('--out', path.join(repo, 'wappen/seed')));
const sheet = argOf('--sheet', '');
const rawDir = path.resolve(argOf('--raw', path.join('/tmp', 'wappen-seed-raw')));   // 렌더 원본(여백 포함) 임시 폴더
rmSync(rawDir, { recursive: true, force: true }); mkdirSync(rawDir, { recursive: true }); mkdirSync(outDir, { recursive: true });

// ESM import 는 NODE_PATH 를 안 보므로 CommonJS require 로 Playwright 를 찾는다
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
// 한글 글꼴(꾸불림체, 저장소 TTF)은 가짜 URL 로 서빙 — about:blank 페이지는 file:// 글꼴을 못 읽는다
const ttf = readFileSync(path.join(repo, 'BMKkubulimTTF.ttf'));
await page.route('http://seed.local/**', (route) => route.fulfill({ status: 200, contentType: 'font/ttf', body: ttf }));

const meta = [];
for (const d of DESIGNS) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @font-face { font-family: 'KkuBulLim'; src: url('http://seed.local/kkubulim.ttf') format('truetype'); }
        html, body { margin: 0; background: transparent; }
        svg { display: block; width: 1024px; height: 1024px; }
        </style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${d.svg}</svg></body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([document.fonts.load("400 100px 'KkuBulLim'"), document.fonts.load('900 100px Inter')]).catch(() => {}));
    const el = await page.$('svg');
    const buf = await el.screenshot({ omitBackground: true, type: 'png' });
    writeFileSync(path.join(rawDir, d.key + '.png'), buf);
    meta.push({ key: d.key, name: d.name, category: d.category, tags: d.tags });
    process.stdout.write(`rendered ${d.key}\n`);
}
await browser.close();
writeFileSync(path.join(rawDir, 'meta.json'), JSON.stringify(meta));

const py = spawnSync('python3', ['-I', path.join(here, 'finish.py'), rawDir, outDir, sheet], { stdio: 'inherit', cwd: repo });
process.exit(py.status || 0);
