// 게더링 일정표 슬롯 정원(2026-11-17) UI 스모크 — 「N/정원」 표시·마감·개인/팀/외부인 신청 제한·팀 정원(팀 수)·편집기 저장
// 팀 신청 테스트(ui-gatheo-team-apply.js)와 같은 가짜 supabase 하네스
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-gatheo-capacity.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const ME = 'a0000000-0000-4000-8000-000000000001', OTHER = 'b0000000-0000-4000-8000-000000000002', THIRD = 'c0000000-0000-4000-8000-000000000003', OUTSIDER = 'd0000000-0000-4000-8000-000000000004';
const DATE = '2026-11-20', KEY = 'slot|1부|19:00';
const TABLES = {
  profiles: [
    { id: ME, kakao_id: 'k-me', name: '홍길동', status: 'approved', role: '운영 총괄', instruments: '기타', created_at: '2026-01-01T00:00:00Z' },
    { id: OTHER, kakao_id: 'k-other', name: '김영희', status: 'approved', role: '일반', instruments: '보컬', created_at: '2026-01-01T00:00:00Z' },
    { id: THIRD, kakao_id: 'k-third', name: '박철수', status: 'approved', role: '일반', instruments: '드럼', created_at: '2026-01-01T00:00:00Z' },
    { id: OUTSIDER, kakao_id: 'k-out', name: '이외부', status: 'approved', role: '일반', instruments: '베이스', created_at: '2026-01-01T00:00:00Z' },
  ],
  teams: [{ id: 't1', name: '록 1팀', members: [{ session: '기타', memberId: ME, leader: true }, { session: '보컬', memberId: OTHER }, { session: '드럼', memberId: THIRD }], created_at: '2026-10-01T00:00:00Z' },
    { id: 't9', name: '남의 팀', members: [{ session: '베이스', memberId: OUTSIDER }], created_at: '2026-10-01T00:00:00Z' }],
  // 19:00 은 정원 4명(멤버 1 + 외부 2 = 3명 차 있음), 20:00 은 정원 없음
  schedules: [
    { id: 's1', date: DATE, group_name: '1부', start_time: '19:00', end_time: '20:00', team_name: '', members: [], songs: [], note: '', allow_guests: true, capacity: 4, team_capacity: null },
    { id: 's2', date: DATE, group_name: '1부', start_time: '20:00', end_time: '21:00', team_name: '', members: [], songs: [], note: '', allow_guests: true, capacity: null, team_capacity: null },
    // 21:00 은 팀 정원 1팀 — 남의 팀이 이미 팀으로 신청해 둠
    { id: 's3', date: DATE, group_name: '1부', start_time: '21:00', end_time: '22:00', team_name: '', members: [], songs: [], note: '', allow_guests: true, capacity: null, team_capacity: 1 },
  ],
  schedule_attendees: [{ id: 'a1', schedule_date: DATE, profile_id: OTHER, group_name: KEY, team_id: null },
    { id: 'a2', schedule_date: DATE, profile_id: OUTSIDER, group_name: 'slot|1부|21:00', team_id: 't9' }],
  schedule_guests: [{ id: 'g1', schedule_date: DATE, slot_key: KEY, host_profile_id: OTHER, guest_count: 2, guest_names: '친구A, 친구B' }],
};
const FAKE_SB = `
(function () {
  const T = window.__T = ${JSON.stringify(TABLES)};
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
      if (st.op === 'insert' && window.__failFull && table === 'schedule_attendees') return Promise.resolve({ data: null, error: { code: 'GA002', message: 'SLOT_FULL' } }).then(res, rej);
      if (st.op === 'insert' && window.__failTeam && table === 'schedule_attendees') return Promise.resolve({ data: null, error: { code: 'GA003', message: 'TEAM_FULL' } }).then(res, rej);
      if (st.op === 'insert' && window.__noTeamCol && table === 'schedule_attendees' && [].concat(st.payload).some(r => 'team_id' in r)) { window.__sbCalls.push({ table, op: 'insert-rejected', payload: st.payload }); return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'team_id' column of 'schedule_attendees' in the schema cache" } }).then(res, rej); }
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
  const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
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
    state.user = { nickname: '홍길동', kakaoId: 'k-me', authType: 'kakao', role: '운영 총괄' };
    loginUI('홍길동');
  });
  await p.waitForTimeout(900);
  await p.evaluate(() => setMemberTab('schedule'));
  await p.waitForTimeout(1200);
  const SEL = (fn, t) => `button[onclick*="${fn}('${DATE}','1부','${t}')"]`;
  const row = (t) => p.evaluate(({ sel }) => { const b = document.querySelector(sel); const r = b.closest('div[style*="border-radius:8px"]'); return {
    count: (r.querySelector('button.status-badge') || {}).textContent || '', chip: (r.querySelector('.gt-cap-chip') || {}).textContent || '',
    team: (r.querySelector('.gt-teamcap-chip') || {}).textContent || '', teamFull: !!r.querySelector('.gt-teamcap-chip.full'),
    apply: b.textContent.trim(), applyOff: b.disabled, guestOff: (r.querySelector('.gt-guest-btn') || {}).disabled }; }, { sel: SEL('toggleSlotAttendance', t) });
  const toast = () => p.evaluate(() => (document.getElementById('auto-toast') || {}).textContent || '');
  const inserts = () => p.evaluate(() => window.__sbCalls.filter(c => c.table === 'schedule_attendees' && c.op === 'insert').length);
  const click = async (sel, ms = 900) => { await p.evaluate(s => document.querySelector(s).click(), sel); await p.waitForTimeout(ms); };

  let r = await row('19:00'), r2 = await row('20:00');
  chk('정원 있는 슬롯: 「3/4명」(멤버 1 + 외부 2), 신청 가능', /3\/4명/.test(r.count) && r.apply === '+ 신청' && !r.applyOff && !r.chip, JSON.stringify(r));
  chk('정원 없는 슬롯: 표시·제한 없음', !/\//.test(r2.count) && !r2.chip && !r2.applyOff, JSON.stringify(r2));

  // 팀으로 신청: 남은 1자리 < 미신청 팀원 2명
  await click(SEL('gtTeamApplySheet', '19:00'), 300);
  chk('팀 시트: 「정원 4명 · 남은 자리 1명」 + 팀 전체 신청 비활성(미신청 2명)', await p.evaluate(() => { const s = document.getElementById('gtSheet'); const b = s.querySelector('.gt-team-apply .gaa-btn-primary'); return /정원 4명 · 남은 자리 1명/.test(s.textContent) && /모두 신청할 수 없어요/.test(s.textContent) && b.disabled; }));
  await p.evaluate(() => gtSheetClose());
  // 외부인: 남은 자리까지만 고를 수 있다
  await click(SEL('gtGuestSheet', '19:00'), 300);
  chk('외부인 시트: 인원 수는 남은 자리(1명)까지만', await p.evaluate(() => document.querySelectorAll('#gtGuestCount option').length === 1 && /남은 자리 1명/.test(document.getElementById('gtSheet').textContent)));
  await p.evaluate(() => gtSheetClose());

  if (process.env.SHOT_DIR) { await p.evaluate(() => document.querySelector('[id^="schedDay-"]').scrollIntoView()); await p.screenshot({ path: process.env.SHOT_DIR + '/cap-view.png', clip: { x: 0, y: 0, width: 420, height: 420 } }); }
  // 그 사이 다른 사람이 마지막 자리를 가져감 → 신청 직전 재확인으로 막힘
  await p.evaluate(({ d, k, o }) => window.__T.schedule_attendees.push({ id: 'a-x', schedule_date: d, profile_id: o, group_name: k }), { d: DATE, k: KEY, o: OUTSIDER });
  const before = await inserts();
  await click(SEL('toggleSlotAttendance', '19:00'));
  r = await row('19:00');
  chk('마지막 자리를 남이 먼저 → 신청 안 들어가고 「정원이 찼어요」', (await inserts()) === before && /정원이 찼어요/.test(await toast()), await toast());
  chk('정원 참: 「4/4명」 + 「마감」 칩, [마감] 버튼·[+ 외부] 비활성', /4\/4명/.test(r.count) && r.chip === '마감' && r.apply === '마감' && r.applyOff && r.guestOff === true, JSON.stringify(r));
  if (process.env.SHOT_DIR) { await p.evaluate(() => document.querySelector('[id^="schedDay-"]').scrollIntoView()); await p.screenshot({ path: process.env.SHOT_DIR + '/cap-full.png', clip: { x: 0, y: 0, width: 420, height: 420 } }); }
  chk('정원 찬 슬롯 옆 정원 없는 슬롯은 그대로 신청 가능', !(await row('20:00')).applyOff);

  // DB 가 거절(동시에 누른 경우) → 안내
  await p.evaluate(async ({ d }) => { const T = window.__T; T.schedule_attendees = T.schedule_attendees.filter(x => x.id !== 'a-x'); await fetchScheduleAttendees([d]); renderMemberPanel(); window.__failFull = true; }, { d: DATE });
  await p.waitForTimeout(700);
  await click(SEL('toggleSlotAttendance', '19:00'));
  chk('DB 정원 오류(SLOT_FULL) → 「방금 정원이 찼어요」', /방금 정원이 찼어요/.test(await toast()), await toast());
  await p.evaluate(() => { window.__failFull = false; });

  // 정상 신청 → 마감, 내 취소는 가능
  await click(SEL('toggleSlotAttendance', '19:00'));
  r = await row('19:00');
  chk('마지막 자리 신청 → 「4/4명」 마감, 내 버튼은 [✓ 취소]', /4\/4명/.test(r.count) && r.chip === '마감' && r.apply === '✓ 취소' && !r.applyOff, JSON.stringify(r));
  await click(SEL('toggleSlotAttendance', '19:00'));
  r = await row('19:00');
  chk('취소 → 「3/4명」, 다시 신청 가능', /3\/4명/.test(r.count) && r.apply === '+ 신청' && !r.applyOff, JSON.stringify(r));

  // ── 팀 정원(21:00 = 1팀, 남의 팀이 이미 신청)
  const K21 = 'slot|1부|21:00';
  let r3 = await row('21:00');
  chk('팀 정원 찬 슬롯: 칩 「팀 1/1」(빨강), 개인 [+ 신청]은 그대로 가능', r3.team === '팀 1/1' && r3.teamFull && !r3.applyOff && !(await row('19:00')).team, JSON.stringify(r3));
  await click(SEL('gtTeamApplySheet', '21:00'), 300);
  chk('팀 시트: 「팀 정원 1팀 · 신청한 팀 1팀 (남의 팀)」 + 팀 전체 신청 비활성', await p.evaluate(() => { const s = document.getElementById('gtSheet'); return /팀 정원 1팀 · 신청한 팀 1팀 \(남의 팀\)/.test(s.textContent) && /팀 정원 1팀이 모두 찼어요/.test(s.textContent) && s.querySelector('.gt-team-apply .gaa-btn-primary').disabled; }));
  await p.evaluate(() => gtSheetClose());
  // 남의 팀이 빠지면 신청 가능 → team_id 를 남긴다
  await p.evaluate(async ({ d }) => { const T = window.__T; T.schedule_attendees = T.schedule_attendees.filter(x => x.id !== 'a2'); await fetchScheduleAttendees([d]); renderMemberPanel(); window.__failTeam = true; }, { d: DATE });
  await p.waitForTimeout(700);
  chk('자리가 나면 「팀 0/1」', (await row('21:00')).team === '팀 0/1' && !(await row('21:00')).teamFull);
  await click(SEL('gtTeamApplySheet', '21:00'), 300);
  await click('#gtSheet .gt-team-apply .gaa-btn-primary');
  chk('DB 팀 정원 오류(TEAM_FULL) → 「방금 팀 정원이 찼어요」', /방금 팀 정원이 찼어요/.test(await toast()), await toast());
  await p.evaluate(() => { window.__failTeam = false; });
  await click(SEL('gtTeamApplySheet', '21:00'), 300);
  await click('#gtSheet .gt-team-apply .gaa-btn-primary');
  const tIns = await p.evaluate((k) => window.__sbCalls.filter(c => c.table === 'schedule_attendees' && c.op === 'insert' && Array.isArray(c.payload) && c.payload[0].group_name === k).pop().payload, K21);
  r3 = await row('21:00');
  chk('팀 신청: 팀원 3명 행에 team_id 기록, 칩 「팀 1/1」', tIns.length === 3 && tIns.every(x => x.team_id === 't1') && r3.team === '팀 1/1' && /3명/.test(r3.count), JSON.stringify(r3));
  await click(SEL('gtTeamApplySheet', '21:00'), 300);
  chk('이미 신청한 팀은 막히지 않음(모두 신청됨 · 팀 정원 안내만)', await p.evaluate(() => { const s = document.getElementById('gtSheet'); return /3\/3명/.test(s.textContent) && !/모두 찼어요/.test(s.textContent) && /신청한 팀 1팀 \(록 1팀\)/.test(s.textContent); }));
  await click('#gtSheet .gt-team-apply .gaa-btn-danger');
  chk('팀 전체 취소 → 「팀 0/1」', (await row('21:00')).team === '팀 0/1');
  // team_id 컬럼이 아직 없으면 빼고 신청(팀 수는 못 셈)
  await p.evaluate(() => { window.__noTeamCol = true; });
  await click(SEL('gtTeamApplySheet', '21:00'), 300);
  await click('#gtSheet .gt-team-apply .gaa-btn-primary');
  const fb = await p.evaluate((k) => { const c = window.__sbCalls.filter(c => c.table === 'schedule_attendees' && c.op === 'insert' && Array.isArray(c.payload) && c.payload[0].group_name === k).pop().payload; return c.length + ':' + c.every(x => !('team_id' in x)); }, K21);
  chk('team_id 컬럼이 없으면 빼고 신청(신청 자체는 됨)', fb === '3:true' && /3명/.test((await row('21:00')).count), fb);
  await p.evaluate(async ({ d, k }) => { window.__noTeamCol = false; state._attNoTeamCol = false; const T = window.__T; T.schedule_attendees = T.schedule_attendees.filter(x => x.group_name !== k); await fetchScheduleAttendees([d]); renderMemberPanel(); }, { d: DATE, k: K21 });
  await p.waitForTimeout(600);

  // 편집기: 정원 칸
  await p.evaluate((d) => schedEditorInit(d), DATE);
  await p.waitForTimeout(300);
  if (process.env.SHOT_DIR) { await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: process.env.SHOT_DIR + '/cap-editor.png' }); }
  chk('편집기: 시간마다 정원 칸(4 / 비어 있음 / 비어 있음) + 팀 칸(비어 있음 / 비어 있음 / 1)', await p.evaluate(() => { const v = [...document.querySelectorAll('#schedEditor .sched-cap:not(.team) input')].map(i => i.value), t = [...document.querySelectorAll('#schedEditor .sched-cap.team input')].map(i => i.value); return v.join('|') === '4||' && t.join('|') === '||1'; }));
  await p.evaluate(() => { const i = document.querySelectorAll('#schedEditor .sched-cap:not(.team) input'); i[0].value = ''; i[0].dispatchEvent(new Event('input')); i[1].value = '6'; i[1].dispatchEvent(new Event('input'));
    const t = document.querySelectorAll('#schedEditor .sched-cap.team input'); t[0].value = '2'; t[0].dispatchEvent(new Event('input')); });
  await p.evaluate(() => saveScheduleForDate()); await p.waitForTimeout(1200);
  let ins = await p.evaluate(() => window.__sbCalls.filter(c => c.table === 'schedules' && c.op === 'insert').pop().payload.map(x => x.start_time + ':' + x.capacity + ':' + x.team_capacity).join(','));
  chk('저장: 비우면 null(제한 없음), 적으면 그 수(인원·팀 따로)', ins === '19:00:null:2,20:00:6:null,21:00:null:1', ins);
  r = await row('19:00'); r2 = await row('20:00');
  chk('저장 뒤 화면: 19:00 제한 없음 · 20:00 「정원 6명」', !/\//.test(r.count) && r.team === '팀 0/2' && r2.chip === '정원 6명', JSON.stringify([r, r2]));

  // 컬럼이 아직 없으면(마이그레이션 전) 빼고 저장 + 안내
  await p.evaluate((d) => { window.__T.schedules.forEach(x => delete x.capacity); state.schedules.forEach(x => delete x.capacity); schedEditorInit(d); }, DATE);
  await p.waitForTimeout(300);
  await p.evaluate(() => { const i = document.querySelectorAll('#schedEditor .sched-cap:not(.team) input'); i[0].value = '5'; i[0].dispatchEvent(new Event('input')); });
  await p.evaluate(() => saveScheduleForDate()); await p.waitForTimeout(400);
  const t1 = await toast(); await p.waitForTimeout(800);
  const noCol = await p.evaluate(() => window.__sbCalls.filter(c => c.table === 'schedules' && c.op === 'insert').pop().payload.every(x => !('capacity' in x)));
  chk('capacity 컬럼이 없으면 빼고 저장(일정은 보존) + SQL 안내', noCol && /20261117_schedule_capacity\.sql/.test(t1), t1);

  chk('pageerror 없음', errs.length === 0, errs.join(' | ').slice(0, 200));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  await br.close();
  process.exit(fail ? 1 : 0);
})();
