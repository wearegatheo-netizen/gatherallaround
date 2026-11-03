// 게더링 일정표 「팀으로 신청」(2026-11-03) UI 스모크 — 내 팀 시트·팀원 일괄 신청/취소·합산
// 외부인 테스트(ui-gatheo-guests.js)와 같은 가짜 supabase 하네스
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-gatheo-team-apply.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const ME = 'a0000000-0000-4000-8000-000000000001', OTHER = 'b0000000-0000-4000-8000-000000000002', THIRD = 'c0000000-0000-4000-8000-000000000003', OUTSIDER = 'd0000000-0000-4000-8000-000000000004';
const DATE = '2026-11-20', KEY = 'slot|1부|19:00';
const TABLES = {
  profiles: [
    { id: ME, kakao_id: 'k-me', name: '홍길동', status: 'approved', role: '일반', instruments: '기타', created_at: '2026-01-01T00:00:00Z' },
    { id: OTHER, kakao_id: 'k-other', name: '김영희', status: 'approved', role: '일반', instruments: '보컬', created_at: '2026-01-01T00:00:00Z' },
    { id: THIRD, kakao_id: 'k-third', name: '박철수', status: 'approved', role: '일반', instruments: '드럼', created_at: '2026-01-01T00:00:00Z' },
    { id: OUTSIDER, kakao_id: 'k-out', name: '이외부', status: 'approved', role: '일반', instruments: '베이스', created_at: '2026-01-01T00:00:00Z' },
  ],
  teams: [
    { id: 't1', name: '록 1팀', members: [{ session: '기타', memberId: ME, leader: true }, { session: '보컬', memberId: OTHER }, { session: '드럼', memberId: THIRD }], created_at: '2026-10-01T00:00:00Z' },
    { id: 't2', name: '지난 팀', end_date: '2026-10-01', members: [{ session: '기타', memberId: ME }], created_at: '2026-09-01T00:00:00Z' },
    { id: 't3', name: '남의 팀', members: [{ session: '베이스', memberId: OUTSIDER }], created_at: '2026-10-01T00:00:00Z' },
  ],
  schedules: [{ id: 's1', date: DATE, group_name: '1부', start_time: '19:00', end_time: '20:00', team_name: '', members: [], songs: [], note: '', allow_guests: true }],
  schedule_attendees: [
    { id: 'a1', schedule_date: DATE, profile_id: ME, group_name: KEY },
  ],
  schedule_guests: [{ id: 'g1', schedule_date: DATE, slot_key: KEY, host_profile_id: OTHER, guest_count: 2, guest_names: '친구A, 친구B' }],
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
  await p.clock.setFixedTime(new Date('2026-11-03T10:00:00+09:00'));
  await p.route('**://**', async r => { const u = new URL(r.request().url()); return u.hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.addScriptTag({ content: FAKE_SB });
  await p.evaluate(() => {
    document.getElementById('portalLoadingScreen')?.remove(); document.getElementById('bgm-player')?.remove(); applyTheme('light');
    supabaseClient = window.__fakeSb;
    state.user = { nickname: '홍길동', kakaoId: 'k-me', authType: 'kakao', role: '일반' };
    loginUI('홍길동');
  });
  await p.waitForTimeout(900);
  await p.evaluate(() => setMemberTab('schedule'));
  await p.waitForTimeout(1200);
  const slotBtnText = () => p.evaluate(() => (document.querySelector('[id^="schedDay-"] .status-badge') || {}).textContent || '');

  chk('슬롯 줄에 [👥 팀] 버튼(내 진행 중 팀 있음)', await p.evaluate(() => { const b = document.querySelector('.gt-team-btn'); return !!b && /팀/.test(b.textContent); }));
  let t = await slotBtnText();
  chk('처음: 멤버 1 + 외부 2 = 3명', /3명/.test(t), t);

  await p.evaluate(() => document.querySelector('.gt-team-btn').click());
  await p.waitForTimeout(300);
  chk('시트: 내 진행 중 팀만(록 1팀) — 지난 팀·남의 팀 제외', await p.evaluate(() => { const c = [...document.querySelectorAll('#gtSheet .gt-team-apply')]; return c.length === 1 && /록 1팀/.test(c[0].textContent) && !/지난 팀|남의 팀/.test(document.getElementById('gtSheet').textContent); }));
  chk('팀 카드: 1/3명 신청됨, 👑 팀장 먼저, 내 칩 ✓, [팀 전체 신청 (+2명)] + [팀 전체 취소]', await p.evaluate(() => { const c = document.querySelector('#gtSheet .gt-team-apply'); const chips = [...c.querySelectorAll('.gt-att-chip')]; return /1\/3명/.test(c.textContent) && chips[0].textContent.includes('👑') && chips[0].textContent.includes('홍길동 ✓') && /\+2명/.test(c.querySelector('.gaa-btn-primary').textContent) && !!c.querySelector('.gaa-btn-danger'); }));

  // 팀 전체 신청
  await p.evaluate(() => document.querySelector('#gtSheet .gt-team-apply .gaa-btn-primary').click());
  await p.waitForTimeout(900);
  const ins = await p.evaluate(() => window.__sbCalls.find(c => c.table === 'schedule_attendees' && c.op === 'insert'));
  chk('schedule_attendees 에 미신청 팀원 2명만 insert(슬롯 키 동일)', !!ins && Array.isArray(ins.payload) && ins.payload.length === 2 && ins.payload.every(r => r.group_name === KEY && r.schedule_date === DATE) && ins.payload.map(r => r.profile_id).sort().join() === [OTHER, THIRD].sort().join(), JSON.stringify(ins && ins.payload));
  chk('시트 닫힘', await p.evaluate(() => !document.getElementById('gtSheet')));
  t = await slotBtnText();
  chk('슬롯 수 멤버 3 + 외부 2 = 5명', /5명/.test(t), t);
  await p.evaluate(() => document.querySelector('[id^="schedDay-"] .status-badge').click());
  chk('명단 팀장별: 「👑 홍길동 · 록 1팀 3」', await p.evaluate(() => { gtAttMode('leader'); const h = [...document.querySelectorAll('.gt-att-h')].map(x => x.textContent).join(' | '); return /홍길동/.test(h) && /록 1팀/.test(h) && /3/.test(h); }));

  // 다시 열면 모두 신청됨
  await p.evaluate(() => document.querySelector('.gt-team-btn').click());
  await p.waitForTimeout(300);
  chk('재진입: 3/3명 · [모두 신청됨] 비활성', await p.evaluate(() => { const c = document.querySelector('#gtSheet .gt-team-apply'); const b = c.querySelector('.gaa-btn-primary'); return /3\/3명/.test(c.textContent) && b.disabled && /모두 신청됨/.test(b.textContent); }));
  // 팀 전체 취소
  await p.evaluate(() => document.querySelector('#gtSheet .gt-team-apply .gaa-btn-danger').click());
  await p.waitForTimeout(900);
  chk('schedule_attendees delete — 팀원 3명 행', await p.evaluate(() => { const d = window.__sbCalls.find(c => c.table === 'schedule_attendees' && c.op === 'delete'); return !!d && d.n === 3; }));
  t = await slotBtnText();
  chk('취소 후 외부 2명만(2명)', /2명/.test(t) && !/5명/.test(t), t);

  // 신청 기간 밖: 신청 비활성, 취소는 가능
  await p.evaluate(() => { state.schedules.forEach(x => { x.signup_close = '2026-11-01T00:00:00+09:00'; }); renderMemberPanel(); });
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('.gt-team-btn').click());
  await p.waitForTimeout(300);
  chk('마감 뒤: 안내문 + [팀 전체 신청] 비활성', await p.evaluate(() => /취소만 할 수 있어요/.test(document.getElementById('gtSheet').textContent) && document.querySelector('#gtSheet .gt-team-apply .gaa-btn-primary').disabled));
  await p.evaluate(() => gtSheetClose());

  // 팀 없는 멤버 → 버튼 없음
  await p.evaluate(() => { state.teams = state.teams.filter(x => x.id !== 't1'); renderMemberPanel(); });
  await p.waitForTimeout(900);
  chk('진행 중 팀이 없으면 [팀] 버튼 없음', await p.evaluate(() => !document.querySelector('.gt-team-btn')));

  chk('pageerror 없음', errs.length === 0, errs.join(' | ').slice(0, 200));
  await br.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
