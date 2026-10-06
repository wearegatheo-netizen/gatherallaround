// 와펜 꾸미기 UI 테스트 (Playwright) — 가짜 supabase·Kakao·/wappen-api 로 홈 → 에디터 → 저장 → 작품 페이지 → 다운로드 흐름 검증.
// 실행: python3 -m http.server 8765 &  →  NODE_PATH=<scratchpad>/node_modules node tests/ui-wappen.js
//   (Playwright 는 저장소에 없음 — 스크래치패드 node_modules 필요, Chromium 은 /opt/pw-browsers/chromium)
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const SHOT_DIR = process.env.SHOT_DIR || '';   // 지정 시 주요 화면 스크린샷 저장
const [VW, VH] = (process.env.VIEWPORT || '1000x800').split('x').map(Number);   // 예: VIEWPORT=390x844 (모바일)
const shot = (p, name) => SHOT_DIR ? p.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false }).catch(() => {}) : Promise.resolve();
const PID = '33333333-3333-4333-8333-333333333333', WID = '44444444-4444-4444-8444-444444444444';
const IT1 = '55555555-5555-4555-8555-555555555555', IT2 = '66666666-6666-4666-8666-666666666666', UID = '11111111-1111-4111-8111-111111111111';
const SB = 'https://sb.test/storage/v1/object/public/wappen';
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const PROJECT = { id: PID, owner_id: UID, author_name: '길동', author_avatar: null, title: '테스트 프로젝트', description: '설명', size_key: 'ig_square', size_group: 'sns', orientation: 'portrait',
    width_px: 1080, height_px: 1080, base_image_url: BASE + '/icon-512.png', thumb_url: BASE + '/icon-192.png', works_count: 1, status: 'active', created_at: new Date().toISOString() };
const PROJECT2 = { ...PROJECT, id: '33333333-3333-4333-8333-333333333334', title: 'A4 포스터', size_key: 'a4', size_group: 'print', width_px: 2480, height_px: 3508 };
const ITEMS = [
    { id: IT1, name: '별', category: '기호', tags: ['반짝'], image_url: BASE + '/icon-192.png', width_px: 192, height_px: 192, sort_order: 0, status: 'active', created_at: new Date().toISOString() },
    { id: IT2, name: '고양이', category: '동물', tags: ['귀여움'], image_url: BASE + '/icon-192.png', width_px: 192, height_px: 192, sort_order: 0, status: 'active', created_at: new Date().toISOString() },
];
const WORK = { id: WID, project_id: PID, author_id: UID, author_name: '길동', author_avatar: null, title: '내 작품', layout: { v: 1, items: [{ id: IT1, x: 0.5, y: 0.5, w: 0.3, r: 0, fx: false }] },
    preview_url: BASE + '/icon-512.png', preview_w: 1080, preview_h: 1080, remix_of: null, reaction_count: 2, reaction_counts: { love: 2 }, status: 'active', created_at: new Date().toISOString(), wappen_projects: PROJECT };

// 페이지에 주입되는 가짜 supabase 쿼리빌더 — eq/ilike/order/range/limit/maybeSingle/rpc 지원
const FAKE = `
window.__sbCalls = []; window.__apiCalls = []; window.__blobs = []; window.__downloads = [];
const TABLES = ${JSON.stringify({ wappen_projects: [PROJECT, PROJECT2], wappen_items: ITEMS, wappen_works: [WORK] })};
const RANK = [{ rank: 1, id: '${WID}', title: '내 작품', preview_url: '${BASE}/icon-512.png', preview_w: 1080, preview_h: 1080, author_name: '길동', author_avatar: null, project_id: '${PID}', project_title: '테스트 프로젝트', size_key: 'ig_square', orientation: 'portrait', score: 2, total: 2 }];
function builder(table) {
  const st = { table, filters: [], single: false, range: null };
  const b = {
    select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, ilike(k, v) { st.filters.push(['~' + k, v]); return b; },
    order() { return b; }, limit(n) { st.range = [0, n - 1]; return b; }, range(a, z) { st.range = [a, z]; return b; }, maybeSingle() { st.single = true; return b; }, single() { st.single = true; return b; },
    then(res) {
      window.__sbCalls.push({ table, filters: st.filters.slice() });
      let rows = (TABLES[table] || []).map(r => ({ ...r }));
      for (const [k, v] of st.filters) { if (k.startsWith('~')) { const t = v.replace(/%/g, '').toLowerCase(); rows = rows.filter(r => String(r[k.slice(1)]).toLowerCase().includes(t)); } else rows = rows.filter(r => r[k] === v); }
      if (table === 'wappen_works') rows.forEach(r => { r.wappen_projects = TABLES.wappen_projects.find(p => p.id === r.project_id) || null; });
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      res({ data: st.single ? (rows[0] || null) : rows, error: null });
    },
  };
  return b;
}
window.supabase = { createClient: () => ({ from: builder, rpc: (name, args) => ({ then: (res) => { window.__sbCalls.push({ rpc: name, args }); res({ data: name === 'wappen_ranking' ? RANK : [], error: null }); } }) }) };
window.Kakao = { isInitialized: () => true, init() {}, Auth: { login({ success }) { success({ access_token: 'kakao-token' }); }, getAccessToken: () => null, setAccessToken() {}, logout(cb) { cb && cb(); } }, Share: { sendDefault(o) { window.__kakaoShare = o; } } };
const ME = { id: '${UID}', nickname: '길동', avatar_url: null, is_admin: false, is_banned: false, created_at: new Date().toISOString() };
const _fetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.endsWith('/wappen-api')) {
    const body = JSON.parse(opts.body || '{}'); window.__apiCalls.push(body);
    const ok = (o) => new Response(JSON.stringify({ ok: true, ...o }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    switch (body.action) {
      case 'me': return ok({ user: ME });
      case 'login': return ok({ session: 'sess-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', user: ME, expires_at: '2099-01-01' });
      case 'my_reactions': return ok({ reactions: {} });
      case 'upload_sign': return ok({ path: body.kind + '/x.jpg', token: 'T', content_type: 'image/jpeg', upload_url: '${BASE}/__upload?token=T', public_url: '${SB}/' + body.kind + 's/${UID}/x.jpg' });
      case 'work_save': return ok({ work: { ...${JSON.stringify(WORK)}, id: '${WID}', title: body.title, layout: body.layout } });
      case 'react': return ok({ mine: body.kind, reaction_count: body.kind ? 3 : 2, reaction_counts: body.kind ? { love: 2, [body.kind]: (body.kind === 'love' ? 3 : 1) } : { love: 2 } });
      default: return ok({});
    }
  }
  if (u.includes('/__upload')) { window.__uploaded = (window.__uploaded || 0) + 1; return new Response('{}', { status: 200 }); }
  return _fetch(url, opts);
};
const _cou = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__blobs.push(b); return _cou(b); };
const _click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return _click.call(this); };
localStorage.setItem('wappen_session', 'sess-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
${process.env.DARK ? "localStorage.setItem('gaa_theme', 'dark');" : ''}
`;

(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, locale: 'ko-KR', hasTouch: VW < 600 });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    // 외부 CDN 차단 (supabase-js·Kakao SDK·폰트) — 주입 스텁이 대신한다
    await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript', body: '' }));
    await p.addInitScript(FAKE);

    // 1. 홈
    await p.goto(`${BASE}/wappen/#/`);
    await p.waitForSelector('.card-grid .card', { timeout: 15000 });
    chk('홈: 프로젝트 카드 2개', await p.locator('.card-grid .card').count() === 2);
    chk('홈: 인기 작품 스트립(랭킹 RPC)', await p.locator('#popStrip .card').count() === 1);
    await shot(p, 'home');
    chk('홈: 로그인 상태 — 아바타 버튼', await p.locator('.wp-avatar-btn').count() === 1 && (await p.locator('.wp-avatar-btn').textContent()).includes('길동'));   // ≤480px 는 닉네임 숨김 → textContent
    await p.click('.chips a:has-text("인쇄")');
    await p.waitForFunction(() => location.hash.includes('group=print'));
    await p.waitForSelector('.chips.scroll a:has-text("A4")');
    await p.click('.chips.scroll a:has-text("A4")');
    await p.waitForFunction(() => location.hash.includes('size=a4'));
    await p.waitForFunction(() => document.querySelectorAll('.card-grid .card').length === 1);
    chk('홈: 사이즈 필터(A4) → 1개', (await p.locator('.card-grid .card .card-title').innerText()) === 'A4 포스터');
    chk('홈: 필터가 supabase eq(size_key) 로 전달', await p.evaluate(() => window.__sbCalls.some(c => c.table === 'wappen_projects' && c.filters.some(f => f[0] === 'size_key' && f[1] === 'a4'))));

    // 1b. 새 프로젝트 화면 (사이즈 선택·업로드 영역) + 모바일 하단 탭바
    await p.goto(`${BASE}/wappen/#/new`); await p.waitForSelector('.size-opt');
    chk('새 프로젝트: 인쇄 사이즈 7개·A4 기본 선택', await p.locator('.size-opt').count() === 7 && (await p.locator('.size-opt.active b').innerText()) === 'A4');
    await p.click('.size-opt[data-k="a3"]'); await p.click('#orientRow [data-o="landscape"]');
    chk('새 프로젝트: A3 가로 → 4961×3508px 안내', (await p.locator('#sizeHelp').innerText()).includes('4961×3508px'));
    const dz = await p.locator('#drop').boundingBox();
    chk('새 프로젝트: 업로드 영역이 블록(폭 ≥ 200px)', dz && dz.width > 200 && dz.height > 60);
    const bottomNavVisible = await p.locator('#bottomNav').isVisible();
    chk(`하단 탭바: ${VW < 640 ? '모바일에서 표시' : '데스크톱에서 숨김'}`, bottomNavVisible === (VW <= 640));
    if (VW <= 640) chk('하단 탭바: 만들기 활성', (await p.locator('#bottomNav a[data-nav="new"]').getAttribute('class') || '').includes('active'));
    await shot(p, 'new');

    // 1c. 프로젝트 상세 — 메타 중복 없음·주 동작 한 줄·⋯ 시트
    await p.goto(`${BASE}/wappen/#/project/${PID}`); await p.waitForSelector('.action-row');
    const metaText = await p.locator('.detail-info .meta-line').innerText();
    chk('프로젝트: 사이즈 메타에 이름은 배지 한 번만', (metaText.match(/인스타그램 정방형/g) || []).length === 1 && metaText.includes('1080×1080px'));
    const projBtnHeights = await p.$$eval('.action-row .gaa-btn', els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    chk('프로젝트: 주 동작 버튼 3개·높이 38px', projBtnHeights.length === 3 && projBtnHeights.every(h => Math.abs(h - 38) <= 1), projBtnHeights.join(','));
    await p.click('.action-row [data-act="more"]'); await p.waitForSelector('.sheet-item');
    const projSheet = await p.$$eval('.sheet-item', els => els.map(e => e.dataset.more));
    chk('프로젝트: ⋯ 시트(소유자) = 정보 수정·숨기기·링크 복사·삭제', projSheet.join() === 'edit,hide,copy,delete');
    await p.keyboard.press('Escape'); await p.waitForSelector('.modal-backdrop', { state: 'detached' });
    await shot(p, 'project');

    // 2. 에디터
    await p.goto(`${BASE}/wappen/#/edit/${PID}`);
    await p.waitForSelector('#edCanvas');
    await p.waitForFunction(() => window.wappen && window.wappen.editor && document.querySelectorAll('.ed-item').length === 2);
    chk('에디터: 와펜 서랍 2개·편집 모드 body.editing', await p.evaluate(() => document.body.classList.contains('editing')));
    chk('에디터: 하단 탭바 숨김', !(await p.locator('#bottomNav').isVisible()));
    await p.click('.ed-item:first-child');
    await p.waitForFunction(() => window.wappen.editor.items.length === 1);
    let it = await p.evaluate(() => window.wappen.editor.items[0]);
    chk('에디터: 와펜 추가 — 중앙 배치', it.id === IT1 && Math.abs(it.x - 0.5) < 0.001 && it.w > 0.1);
    chk('에디터: 선택 툴바 표시', !(await p.locator('#edTools').getAttribute('class')).includes('hidden'));
    const box = await p.locator('#edCanvas').boundingBox();
    const cx = box.x + box.width * it.x, cy = box.y + box.height * it.y;
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 40, cy + 20, { steps: 5 }); await p.mouse.move(cx + 80, cy + 40, { steps: 5 }); await p.mouse.up();
    it = await p.evaluate(() => window.wappen.editor.items[0]);
    chk('에디터: 드래그 이동', it.x > 0.55 && it.y > 0.52, `x=${it.x.toFixed(3)} y=${it.y.toFixed(3)}`);
    await shot(p, 'editor');
    chk('에디터: undo 버튼 활성', !(await p.locator('[data-act="undo"]').isDisabled()));
    await p.click('[data-act="undo"]');
    it = await p.evaluate(() => window.wappen.editor.items[0]);
    chk('에디터: undo → 원위치', Math.abs(it.x - 0.5) < 0.001);
    await p.click('[data-act="redo"]');
    it = await p.evaluate(() => window.wappen.editor.items[0]);
    chk('에디터: redo → 이동 복원', it.x > 0.55);
    await p.click('.ed-tools [data-act="flip"]');
    chk('에디터: 반전', await p.evaluate(() => window.wappen.editor.items[0].fx === true));
    await p.click('.ed-tools [data-act="dup"]');
    chk('에디터: 복제 → 2개', await p.evaluate(() => window.wappen.editor.items.length === 2));
    await p.click('.ed-tools [data-act="del"]');
    chk('에디터: 삭제 → 1개', await p.evaluate(() => window.wappen.editor.items.length === 1));
    await p.fill('#edSearch', '고양');
    await p.waitForFunction(() => document.querySelectorAll('.ed-item').length === 1);
    chk('에디터: 서랍 검색', (await p.locator('.ed-item span').innerText()) === '고양이');

    // 3. 저장 → 작품 페이지
    await p.click('.ed-topbar [data-act="save"]');
    await p.waitForSelector('.modal input');
    chk('저장: 제목 모달 기본값=프로젝트명', (await p.inputValue('.modal input')) === '테스트 프로젝트');
    await p.fill('.modal input', '첫 작품');
    await p.click('.modal [data-ok]');
    await p.waitForFunction(() => location.hash === `#/work/${'44444444-4444-4444-8444-444444444444'}`, null, { timeout: 15000 });
    const calls = await p.evaluate(() => window.__apiCalls);
    const save = calls.find(c => c.action === 'work_save');
    chk('저장: upload_sign(preview) → PUT 업로드 → work_save', calls.some(c => c.action === 'upload_sign' && c.kind === 'preview') && (await p.evaluate(() => window.__uploaded)) === 1 && !!save);
    chk('저장: payload 레이아웃 v1·좌표 범위·세션 포함', save && save.layout.v === 1 && save.layout.items.length === 1 && save.layout.items[0].fx === true && save.layout.items[0].x > 0.55 && save.layout.items[0].x <= 1.5 && save.title === '첫 작품' && save.project_id === PID && save.preview_url.startsWith(SB + '/previews/') && typeof save.session === 'string');
    await p.waitForSelector('.reaction-bar .reaction-btn');
    chk('작품: 반응 버튼 5종', await p.locator('.reaction-btn').count() === 5);
    chk('작품: 편집 모드 해제', !(await p.evaluate(() => document.body.classList.contains('editing'))));
    await p.click('.reaction-btn[data-react="fire"]');
    await p.waitForFunction(() => window.__apiCalls.some(c => c.action === 'react' && c.kind === 'fire'));
    await shot(p, 'work');
    chk('작품: 반응 → react API·활성 표시', (await p.locator('.reaction-btn[data-react="fire"]').getAttribute('class')).includes('active'));

    // 4. 다운로드 (실제 캔버스 렌더)
    const workBtnHeights = await p.$$eval('.action-row .gaa-btn', els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    chk('작품: 주 동작 버튼 4개(다운로드·공유·이어 꾸미기·⋯) 높이 38px', workBtnHeights.length === 4 && workBtnHeights.every(h => Math.abs(h - 38) <= 1), workBtnHeights.join(','));
    const actionRowTop = await p.$$eval('.action-row .gaa-btn', els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size);
    chk('작품: 주 동작이 한 줄', actionRowTop === 1);
    await p.click('.action-row [data-act="more"]'); await p.waitForSelector('.sheet-item');
    const workSheet = await p.$$eval('.sheet-item', els => els.map(e => e.dataset.more));
    chk('작품: ⋯ 시트(작성자) = 작품 수정·링크 복사·삭제', workSheet.join() === 'edit,copy,delete', workSheet.join());
    await p.keyboard.press('Escape'); await p.waitForSelector('.modal-backdrop', { state: 'detached' });
    const emojiBtns = await p.$$eval('.gaa-btn', els => els.map(e => e.textContent.trim()).filter(t => /\p{Extended_Pictographic}/u.test(t)));
    chk('일관성: 버튼 텍스트에 이모지 없음', emojiBtns.length === 0, emojiBtns.join(' | '));
    await p.click('[data-act="download"]');
    await p.waitForSelector('#dlGo');
    await p.click('#dlGo');
    await p.waitForFunction(() => window.__downloads.length === 1, null, { timeout: 20000 });
    const dims = await p.evaluate(async () => { const b = window.__blobs[window.__blobs.length - 1]; const bm = await createImageBitmap(b); return { w: bm.width, h: bm.height, type: b.type, size: b.size }; });
    chk('다운로드: 1080×1080 PNG 생성', dims.w === 1080 && dims.h === 1080 && dims.type === 'image/png' && dims.size > 1000, JSON.stringify(dims));
    chk('다운로드: 파일명에 사이즈 표기', (await p.evaluate(() => window.__downloads[0])).includes('인스타그램'));

    // 5. 공유 시트 → 카카오
    await p.keyboard.press('Escape');
    await p.click('[data-act="share"]');
    await p.click('[data-s="kakao"]');
    const share = await p.evaluate(() => window.__kakaoShare);
    chk('공유: 카카오 feed 링크는 루트+쿼리(?ww=)·미리보기 이미지', share && share.objectType === 'feed' && share.content.link.webUrl === `https://gatherallaround.com/?ww=${WID}` && share.content.link.mobileWebUrl === share.content.link.webUrl && share.buttons[0].link.webUrl === share.content.link.webUrl && share.content.imageUrl.includes('icon-512'));
    await p.click('.action-row [data-act="more"]'); await p.waitForSelector('.sheet-item[data-more="copy"]');
    await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
    await p.click('.sheet-item[data-more="copy"]'); await p.waitForFunction(() => window.__copied !== null);
    chk('링크 복사도 루트+쿼리 형태', (await p.evaluate(() => window.__copied)) === `https://gatherallaround.com/?ww=${WID}`);

    // 6. 랭킹·카탈로그·요청·내 페이지 렌더
    await p.goto(`${BASE}/wappen/#/ranking`); await p.waitForSelector('.rank-row');
    await shot(p, 'ranking');
    chk('랭킹: 1위 🥇 표시', (await p.locator('.rank-no').first().innerText()).includes('🥇'));
    await p.goto(`${BASE}/wappen/#/items`); await p.waitForSelector('.item-card');
    chk('카탈로그: 와펜 2개·카테고리 칩', await p.locator('.item-card').count() === 2 && await p.locator('.chips .chip').count() === 3);
    await p.goto(`${BASE}/wappen/#/me`); await p.waitForSelector('.tabs');
    chk('내 페이지: my_content 호출', await p.evaluate(() => window.__apiCalls.some(c => c.action === 'my_content')));
    await p.goto(`${BASE}/wappen/#/admin`); await p.waitForSelector('.empty');
    chk('관리자: 일반 사용자 접근 거절', (await p.locator('.empty').innerText()).includes('관리자만'));
    // 쿼리 진입 → 해시 치환
    await p.goto(`${BASE}/wappen/?w=${WID}`); await p.waitForSelector('.reaction-bar');
    chk('예전 공유 링크 /wappen/?w= → #/work/ 치환', await p.evaluate(() => location.hash === '#/work/44444444-4444-4444-8444-444444444444' && location.search === ''));
    await p.goto(`${BASE}/wappen/?wp=${PID}`); await p.waitForSelector('.action-row');
    chk('/wappen/?wp= 직접 진입 → #/project/', await p.evaluate(() => location.hash === '#/project/33333333-3333-4333-8333-333333333333'));
    // 루트 index.html 로 들어온 공유 링크(카카오톡 표준 형태) → 맨 앞 스크립트가 와펜 해시 라우트로 즉시 넘김
    await p.goto(`${BASE}/?wp=${PID}`); await p.waitForURL(/\/wappen\/#\/project\/33333333-3333-4333-8333-333333333333$/, { timeout: 15000 }); await p.waitForSelector('.action-row');
    chk('루트 /?wp= → /wappen/#/project/ 리다이렉트 후 프로젝트 렌더', (await p.locator('.detail-info h1').innerText()) === '테스트 프로젝트');
    await p.goto(`${BASE}/?ww=${WID.toUpperCase()}`); await p.waitForURL(/\/wappen\/#\/work\/44444444-4444-4444-8444-444444444444$/, { timeout: 15000 }); await p.waitForSelector('.reaction-bar');
    chk('루트 /?ww=(대문자) → /wappen/#/work/ 소문자 리다이렉트', true);
    await p.goto(`${BASE}/?p=${PID}`); await p.waitForURL(/\/wappen\/#\/project\//, { timeout: 15000 });
    chk('루트의 예전 ?p= 도 리다이렉트', true);

    chk('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
