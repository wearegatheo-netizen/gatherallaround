// 게더링 일정표 외부인 참여 신청(2026-11-02) UI 스모크 — 슬롯 수 합산·시트 신청/수정/삭제·전체 참여·홈 카드
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-gatheo-guests.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const ME = 'a0000000-0000-4000-8000-000000000001', OTHER = 'b0000000-0000-4000-8000-000000000002';
const DATE = '2026-11-20', KEY = 'slot|1부|19:00';
const TABLES = {
  profiles: [
    { id: ME, kakao_id: 'k-me', name: '홍길동', status: 'approved', role: '일반', instruments: '기타', created_at: '2026-01-01T00:00:00Z' },
    { id: OTHER, kakao_id: 'k-other', name: '김영희', status: 'approved', role: '일반', instruments: '보컬', created_at: '2026-01-01T00:00:00Z' },
  ],
  schedules: [{ id: 's1', date: DATE, group_name: '1부', start_time: '19:00', end_time: '20:00', team_name: '', members: [], songs: [], note: '', allow_guests: true }],
  schedule_attendees: [
    { id: 'a1', schedule_date: DATE, profile_id: ME, group_name: KEY },
    { id: 'a2', schedule_date: DATE, profile_id: OTHER, group_name: KEY },
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
  await p.clock.setFixedTime(new Date('2026-11-02T10:00:00+09:00'));
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

  // 1. 슬롯 수 = 멤버 2 + 외부 2
  let t = await slotBtnText();
  chk('슬롯 참여 수가 멤버+외부 합산(4명 · 외부 2)', /4명/.test(t) && /외부 2/.test(t), t);
  chk('내 외부인 신청이 없으면 [+ 외부] 버튼', await p.evaluate(() => { const b = document.querySelector('.gt-guest-btn'); return !!b && !b.classList.contains('mine') && b.textContent.trim() === '+ 외부'; }));
  // 명단 열기 → 외부 칩
  await p.evaluate(() => document.querySelector('[id^="schedDay-"] .status-badge').click());
  chk('명단에 외부 참여 묶음(총 2) + 「친구A, 친구B · 김영희」 칩', await p.evaluate(() => { const g = document.querySelector('.gt-att-guests'); return !!g && /외부 참여/.test(g.textContent) && /2/.test(g.querySelector('.gt-att-h b').textContent) && /친구A, 친구B/.test(g.textContent) && /김영희/.test(g.textContent); }));
  chk('전체 참여 4명 · 멤버 2 · 외부 2', await p.evaluate(() => { const b = [...document.querySelectorAll('[id^="schedDay-"] button')].find(x => /전체 참여/.test(x.textContent)); return !!b && /4명/.test(b.textContent) && /멤버 2/.test(b.textContent) && /외부 2/.test(b.textContent); }));

  // 2. 신청 시트 → 저장
  await p.evaluate(() => document.querySelector('.gt-guest-btn').click());
  await p.waitForTimeout(300);
  chk('시트 열림: 인원 수 셀렉트 + 누구 입력, 삭제 버튼 없음', await p.evaluate(() => !!document.querySelector('#gtSheet #gtGuestForm') && !!document.getElementById('gtGuestCount') && !!document.getElementById('gtGuestNames') && !document.querySelector('#gtGuestForm .gaa-btn-danger')));
  await p.selectOption('#gtGuestCount', '1');
  await p.fill('#gtGuestNames', '동생');
  await p.evaluate(() => document.querySelector('#gtGuestForm button[type=submit]').click());
  await p.waitForTimeout(900);
  const ins = await p.evaluate(() => window.__sbCalls.find(c => c.table === 'schedule_guests' && c.op === 'insert'));
  chk('schedule_guests insert — 내 프로필·슬롯 키·1명·동생', !!ins && ins.payload.host_profile_id === ME && ins.payload.slot_key === KEY && ins.payload.guest_count === 1 && ins.payload.guest_names === '동생', JSON.stringify(ins && ins.payload));
  chk('시트 닫힘', await p.evaluate(() => !document.getElementById('gtSheet')));
  t = await slotBtnText();
  chk('슬롯 수 5명 · 외부 3 으로 갱신', /5명/.test(t) && /외부 3/.test(t), t);
  chk('내 버튼이 「👥 외부 1」(수정 모드)', await p.evaluate(() => { const b = document.querySelector('.gt-guest-btn'); return !!b && b.classList.contains('mine') && /외부 1/.test(b.textContent); }));
  await p.evaluate(() => document.querySelector('[id^="schedDay-"] .status-badge').click());
  chk('명단 외부 칩 2줄, 내 것은 .me', await p.evaluate(() => { const c = document.querySelectorAll('.gt-att-guests .gt-att-chip.guest'); return c.length === 2 && [...c].some(x => x.classList.contains('me') && /동생/.test(x.textContent) && /홍길동/.test(x.textContent)); }));
  chk('전체 참여 5명 · 멤버 2 · 외부 3', await p.evaluate(() => { const b = [...document.querySelectorAll('[id^="schedDay-"] button')].find(x => /전체 참여/.test(x.textContent)); return !!b && /5명/.test(b.textContent) && /외부 3/.test(b.textContent); }));

  // 3. 홈 카드에 합산
  await p.evaluate(() => setGatheOTab('home'));
  await p.waitForTimeout(900);
  const home = await p.evaluate(() => (document.getElementById('gtNextSched') || {}).textContent || '');
  chk('홈 다음 합주 카드 「5명 참석 (외부 3)」', /5명 참석 \(외부 3\)/.test(home), home.replace(/\s+/g, ' ').slice(0, 120));

  // 4. 수정 → 삭제
  await p.evaluate(() => setMemberTab('schedule'));
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.querySelector('.gt-guest-btn.mine').click());
  await p.waitForTimeout(300);
  chk('수정 시트: 기존 값(1명·동생) 채움 + 삭제 버튼', await p.evaluate(() => document.getElementById('gtGuestCount').value === '1' && document.getElementById('gtGuestNames').value === '동생' && !!document.querySelector('#gtGuestForm .gaa-btn-danger')));
  await p.evaluate(() => document.querySelector('#gtGuestForm .gaa-btn-danger').click());
  await p.waitForTimeout(900);
  chk('schedule_guests delete 호출', await p.evaluate(() => window.__sbCalls.some(c => c.table === 'schedule_guests' && c.op === 'delete' && c.n === 1)));
  t = await slotBtnText();
  chk('삭제 후 4명 · 외부 2 로 복귀, 버튼은 [+ 외부]', /4명/.test(t) && /외부 2/.test(t) && await p.evaluate(() => document.querySelector('.gt-guest-btn').textContent.trim() === '+ 외부'), t);

  // 4b. 날짜별 「외부인 참여 신청 받기」(schedules.allow_guests, 2026-11-02)
  chk('허용 날짜: 머리줄 「👥 외부인 참여 가능」 칩', await p.evaluate(() => /외부인 참여 가능/.test(document.querySelector('[id^="schedDay-"]').textContent)));
  await p.evaluate(() => { state.schedules.forEach(x => x.allow_guests = false); renderMemberPanel(); });
  await p.waitForTimeout(900);
  chk('받지 않는 날짜: [+ 외부] 버튼·칩 없음, 기존 외부 2명은 그대로 합산', await p.evaluate(() => { const d = document.querySelector('[id^="schedDay-"]'); return !document.querySelector('.gt-guest-btn') && !/외부인 참여 가능/.test(d.textContent) && /4명/.test(d.querySelector('.status-badge').textContent); }));
  await p.evaluate(() => { state.schedules.forEach(x => delete x.allow_guests); renderMemberPanel(); });
  await p.waitForTimeout(900);
  chk('컬럼 없음(마이그레이션 전): 종전처럼 허용', await p.evaluate(() => !!document.querySelector('.gt-guest-btn')));
  // 편집기(관리자): 체크박스 + 저장 payload
  await p.evaluate(() => { state.user.role = '총괄'; state.schedules.forEach(x => x.allow_guests = true); renderMemberPanel(); });
  await p.waitForTimeout(900);
  await p.evaluate(() => schedEditorInit('2026-11-20'));
  await p.waitForTimeout(300);
  chk('편집기에 「외부인 참여 신청 받기」 체크박스(기존 값 켜짐)', await p.evaluate(() => { const c = document.getElementById('schedGuestToggle'); return !!c && c.checked; }));
  await p.evaluate(() => { document.getElementById('schedGuestToggle').checked = false; state.scheduleEditorAllowGuests = false; });
  await p.evaluate(() => saveScheduleForDate());
  await p.waitForTimeout(900);
  const savedRows = await p.evaluate(() => { const c = [...window.__sbCalls].reverse().find(x => x.table === 'schedules' && x.op === 'insert'); return c && c.payload; });
  chk('저장 payload 에 allow_guests:false', Array.isArray(savedRows) && savedRows.length === 1 && savedRows[0].allow_guests === false, JSON.stringify(savedRows && savedRows[0] && savedRows[0].allow_guests));
  chk('저장 뒤 옛 행은 id 로 삭제(날짜 전체 삭제 아님), 일정 1건 유지', await p.evaluate(() => { const d = window.__sbCalls.filter(c => c.table === 'schedules' && c.op === 'delete'); return d.length >= 1 && d.every(x => x.n === 1) && state.schedules.filter(x => x.date === '2026-11-20').length === 1; }));
  // 4c. 2026-11-02 유실 사고 재현: 컬럼이 없는 DB(PGRST204) 에서 저장 — 일정이 사라지면 안 되고, allow_guests 를 빼고 다시 저장돼야 한다
  await p.evaluate(() => {
    const orig = window.__fakeSb.from; window.__pgrstHits = 0;
    window.__fakeSb.from = (tb) => { const b = orig(tb); if (tb !== 'schedules') return b; const ins = b.insert; b.insert = (rows) => { const arr = Array.isArray(rows) ? rows : [rows]; if (arr.some(r => 'allow_guests' in r)) { window.__pgrstHits++; b.then = (res) => Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'allow_guests' column of 'schedules' in the schema cache" } }).then(res); return b; } return ins(rows); }; return b; };
    state.schedules.forEach(x => { x.allow_guests = true; }); // 상태엔 값이 있어 "컬럼 있음"으로 보이는 상황(옛 탭) — 서버가 거절
    schedEditorInit('2026-11-20');
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => saveScheduleForDate());
  await p.waitForTimeout(900);
  chk('컬럼 없는 DB: PGRST204 를 받으면 allow_guests 빼고 재저장, 일정 1건 그대로', await p.evaluate(() => window.__pgrstHits === 1 && state.schedules.filter(x => x.date === '2026-11-20').length === 1 && document.querySelector('#schedDay-2026-11-20') !== null));
  await p.evaluate(() => { state.user.role = '일반'; state.schedules.forEach(x => x.allow_guests = true); });

  // 5. 표가 없는 환경(42P01) → 버튼 숨김·조용히
  await p.evaluate(() => { const orig = window.__fakeSb.from; window.__fakeSb.from = (t) => { if (t !== 'schedule_guests') return orig(t); const b = orig(t); b.then = (res) => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(res); return b; }; state._attLoaded = new Set(); state._guestsUnavailable = false; });
  await p.evaluate(() => renderMemberPanel());
  await p.waitForTimeout(1000);
  t = await slotBtnText();
  chk('마이그레이션 전: 외부 버튼 없음, 멤버 수만(2명)', await p.evaluate(() => !document.querySelector('.gt-guest-btn') && state._guestsUnavailable === true) && /2명/.test(t) && !/외부/.test(t), t);

  chk('pageerror 없음', errs.length === 0, errs.join(' | ').slice(0, 200));
  await br.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
