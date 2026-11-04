// 게더링 예약 탭: 공간 대관 대기(pending) 건도 자리를 차지하는지(2026-11-04) — 가상 예약 행·주간 칸 라벨·제출 충돌
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-gatheo-perf-block.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const ME = 'a0000000-0000-4000-8000-000000000001', OTHER = 'b0000000-0000-4000-8000-000000000002';
const DATE = '2026-11-20', KEY = 'slot|1부|19:00';
const NOW = '2026-11-04T10:00:00+09:00';
const D = '2026-11-12';
const TABLES = {
  profiles: [{ id: ME, kakao_id: 'k-me', name: '홍길동', status: 'approved', role: '일반', instruments: '기타', created_at: '2026-01-01T00:00:00Z' }],
  reservations: [],
  performance_bookings: [
    { id: 'pb-ok', date: D, start_time: '18:00', end_time: '20:00', status: 'approved', created_at: '2026-11-01T00:00:00Z' },
    { id: 'pb-wait', date: D, start_time: '14:00', end_time: '16:00', status: 'pending', created_at: '2026-11-04T00:30:00Z' },   // 1.5h 전 — 살아 있는 대기
    { id: 'pb-old', date: D, start_time: '10:00', end_time: '12:00', status: 'pending', created_at: '2026-11-03T20:00:00Z' },    // 5h 전 — 만료(lazy)
    { id: 'pb-rej', date: D, start_time: '12:00', end_time: '13:00', status: 'rejected', created_at: '2026-11-01T00:00:00Z' },
  ],
};
const FAKE_SB = `
(function () {
  const T = ${JSON.stringify(TABLES)};
  window.__sbCalls = [];
  function builder(table) {
    const st = { table, op: 'select', filters: [], payload: null, single: false };
    const b = {};
    const chain = (k, f) => { b[k] = (...a) => { f(...a); return b; }; };
    chain('select', () => {}); chain('insert', (row) => { st.op = 'insert'; st.payload = row; }); chain('update', (row) => { st.op = 'update'; st.payload = row; });
    chain('delete', () => { st.op = 'delete'; }); chain('upsert', (row) => { st.op = 'insert'; st.payload = row; });
    chain('eq', (c, v) => st.filters.push(r => r[c] === v)); chain('neq', (c, v) => st.filters.push(r => r[c] !== v));
    chain('in', (c, vs) => st.filters.push(r => vs.includes(r[c]))); chain('is', (c, v) => st.filters.push(r => r[c] == v));
    chain('not', () => {}); chain('lt', () => {}); chain('gte', () => {}); chain('lte', () => {}); chain('gt', () => {});
    chain('order', () => {}); chain('limit', () => {}); chain('range', () => {}); chain('maybeSingle', () => { st.single = true; }); chain('single', () => { st.single = true; });
    b.then = (res, rej) => {
      const rows = (T[table] || (T[table] = []));
      const hit = rows.filter(r => st.filters.every(f => f(r)));
      window.__sbCalls.push({ table, op: st.op, payload: st.payload, n: hit.length });
      let data = null, error = null;
      if (st.op === 'select') data = st.single ? (hit[0] || null) : hit;
      else if (st.op === 'insert') { const mk = (pl) => Object.assign({ id: 'new-' + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString() }, pl); const added = (Array.isArray(st.payload) ? st.payload : [st.payload]).map(mk); added.forEach(r => rows.push(r)); data = st.single ? added[0] : added; }
      else if (st.op === 'update') { hit.forEach(r => Object.assign(r, st.payload)); data = hit; }
      else if (st.op === 'delete') { hit.forEach(r => rows.splice(rows.indexOf(r), 1)); data = hit; }
      return Promise.resolve({ data, error }).then(res, rej);
    };
    return b;
  }
  window.__fakeSb = { from: builder,
    auth: { signOut: async () => ({}), getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} };
})();`;

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await br.newContext({ viewport: { width: 420, height: 950 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date(NOW));
  await p.route('**://**', async r => { const u = new URL(r.request().url()); return u.hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });
  const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.addScriptTag({ content: FAKE_SB });
  await p.evaluate(() => {
    document.getElementById('portalLoadingScreen')?.remove(); document.getElementById('bgm-player')?.remove(); applyTheme('light');
    supabaseClient = window.__fakeSb;
    state.user = { nickname: '홍길동', kakaoId: 'k-me', authType: 'kakao', role: '일반' };
    loginUI('홍길동');
  });
  await p.waitForTimeout(1000);

  const virt = await p.evaluate(() => (state.reservations || []).filter(r => r.__perf).map(r => [r.id, r.status, r.start_time]));
  chk('가상 예약 = 확정 1 + 살아 있는 대기 1 (만료 대기·거절 제외)', virt.length === 2 && virt.some(v => v[0] === 'perf-pb-ok' && v[1] === 'approved') && virt.some(v => v[0] === 'perf-pb-wait' && v[1] === 'pending'), JSON.stringify(virt));

  // 주간 시간표에서 라벨 확인
  await p.evaluate((D) => { setGatheOTab('reservation'); state.currentView = 'week'; state.viewDate = new Date(D + 'T00:00:00'); state.selectedDate = new Date(D + 'T00:00:00'); render(); }, D);
  await p.waitForTimeout(600);
  const labels = await p.evaluate(() => [...document.querySelectorAll('.slot-occupied')].map(s => s.textContent.trim()));
  chk('주간 칸: 「🎭 대관 대기」·「🎭 공간 대관」 라벨, 만료 건 없음', labels.includes('🎭 대관 대기') && labels.includes('🎭 공간 대관') && labels.filter(l => /대관/.test(l)).length >= 2, JSON.stringify(labels.slice(0, 6)));

  // 대기 건과 겹치는 시간에 제출 → 충돌 알림, insert 없음
  await p.evaluate((D) => { state.selectedDate = new Date(D + 'T00:00:00'); state.startTime = '14:00'; state.endTime = '15:00'; }, D);
  await p.evaluate(() => { const f = document.querySelector('form#reservationForm, #reservationForm'); if (f) f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); else window.__noForm = true; });
  await p.waitForTimeout(900);
  const noForm = await p.evaluate(() => !!window.__noForm);
  const inserted = await p.evaluate(() => window.__sbCalls.some(c => c.table === 'reservations' && c.op === 'insert'));
  chk('대기 중 대관 시간에 제출하면 「이미 예약된 시간대」 알림 + reservations insert 없음', !noForm && dialogs.some(m => /이미 예약된 시간대/.test(m)) && !inserted, (noForm ? 'form not found' : dialogs.join(' | ').slice(0, 120)));

  chk('pageerror 없음', errs.length === 0, errs.join(' | ').slice(0, 200));
  await br.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
