// 포털 히어로용 경량 WebP 생성 — studio 사진 원본(0.7~3.6MB)을 가로 960px·품질 0.78 WebP 로 img/portal/ 에 저장 (브라우저 캔버스 사용)
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tools/make-portal-hero.js — 사진을 추가하면 files 목록에 넣고 다시 실행
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const OUT = '/home/user/gatherallaround/img/portal'; fs.mkdirSync(OUT, { recursive: true });
const files = ['studio1.jpg','studio2.jpg','studio3.jpg','studio4.jpg','studio5.jpg','studio6.jpg','studio7.png','studio8.png','studio9.jpg','studio10.png','studio11.jpg'];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'commit' });
  for (const f of files) {
    const data = await page.evaluate(async (f) => {
      const img = new Image(); img.src = '/' + f; await img.decode();
      const W = Math.min(960, img.naturalWidth), H = Math.round(img.naturalHeight * W / img.naturalWidth);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, 0, 0, W, H);
      return { b64: c.toDataURL('image/webp', 0.78).split(',')[1], W, H, nw: img.naturalWidth, nh: img.naturalHeight };
    }, f);
    const out = path.join(OUT, f.replace(/\.(jpe?g|png)$/i, '.webp'));
    fs.writeFileSync(out, Buffer.from(data.b64, 'base64'));
    console.log(`${f} ${data.nw}x${data.nh} -> ${data.W}x${data.H} ${(fs.statSync(out).size/1024).toFixed(0)}KB`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
