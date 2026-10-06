// 기본 와펜 세트 정합성 — manifest.js 와 wappen/seed/*.png 가 맞는지 (빌드 산출물 검증)
// 실행: node tests/wappen-seed-unit.mjs
import { SEED_ITEMS, SEED_VERSION } from '../wappen/seed/manifest.js';
import { CATEGORIES, DESIGNS } from '../tools/wappen-seed/designs.mjs';
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });   // IHDR

chk('버전·개수', SEED_VERSION === 1 && SEED_ITEMS.length >= 60 && SEED_ITEMS.length === DESIGNS.length, String(SEED_ITEMS.length));
chk('key 고유', new Set(SEED_ITEMS.map(i => i.key)).size === SEED_ITEMS.length);
chk('key 형식(파일명 안전)', SEED_ITEMS.every(i => /^[a-z0-9-]{2,30}$/.test(i.key) && i.file === i.key + '.png'));
chk('이름·카테고리·태그 형식', SEED_ITEMS.every(i => i.name && i.name.length <= 40 && CATEGORIES.includes(i.category) && Array.isArray(i.tags) && i.tags.length >= 1 && i.tags.length <= 10 && i.tags.every(t => t.length <= 20)));
chk('카테고리 6종 모두 사용', CATEGORIES.every(c => SEED_ITEMS.some(i => i.category === c)));
let dimsOk = true, sizeOk = true, total = 0, missing = [];
for (const it of SEED_ITEMS) {
    const p = new URL('../wappen/seed/' + it.file, import.meta.url);
    if (!existsSync(p)) { missing.push(it.file); continue; }
    const buf = readFileSync(p); total += buf.length;
    const { w, h } = pngSize(buf);
    if (w !== it.w || h !== it.h) dimsOk = false;
    if (w < 300 || h < 300 || w > 1024 || h > 1024 || buf.length > 120 * 1024) sizeOk = false;
    if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) dimsOk = false;
}
chk('모든 파일 존재', missing.length === 0, missing.join(','));
chk('PNG 크기가 manifest 와 일치', dimsOk);
chk('치수 300~1024px · 파일 ≤120KB', sizeOk, `총 ${(total / 1024).toFixed(0)}KB`);
chk('DB check 범위(width/height 8~4000) 충족', SEED_ITEMS.every(i => i.w >= 8 && i.w <= 4000 && i.h >= 8 && i.h <= 4000));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
