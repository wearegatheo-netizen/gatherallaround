// 게더링 관리자 「시간차단」 재점검(2026-11-08): 겹침 정책(완전 중복만 차단·일부 겹침은 확인)·지난 차단 무시·이중 제출 차단·중복 정리·고정팀/커뮤니티 차단 표시·달력 겹침 라벨
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-gatheo-blocks.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const ME = 'a0000000-0000-4000-8000-000000000001';
const NOW = '2026-11-08T10:00:00+09:00'; // 일요일. 11/9 월 · 11/10 화 · 11/11 수 · 11/12 목 · 11/13 금 · 11/14 토
const TB = (id, dow, st, et, reason, sd, ed, extra = {}) => Object.assign({ id, day_of_week: dow, start_time: st, end_time: et, reason, start_date: sd, end_date: ed, skip_dates: [], created_at: '2026-10-01T00:00:00Z' }, extra);
const TABLES = {
  profiles: [{ id: ME, kakao_id: 'k-me', name: '운영자', status: 'approved', role: '운영 총괄', instruments: '기타', created_at: '2026-01-01T00:00:00Z' }],
  reservations: [], performance_bookings: [], schedules: [], schedule_attendees: [], comments: [], notices: [], teams: [], documents: [],
  time_blocks: [
    TB('b-band', 5, '18:00', '22:00', '[고정팀] 벤더', '2026-11-06', null, { band_claim_id: 'claim-1', skip_dates: ['2026-11-20'], created_at: '2026-11-01T00:00:00Z' }), // 금 18~23 · 11/20 건너뜀
    TB('b-mon', 1, '08:00', '09:00', '정기 점검', null, null),                                        // 매주 월 08~10 영구
    TB('b-past', 4, '10:00', '11:00', '지난 차단', '2026-10-01', '2026-10-01'),                         // 지난 목요일 1회
    TB('b-dup1', 3, '18:00', '22:00', '구 고정팀 차단', null, null, { created_at: '2026-09-01T00:00:00Z' }), // 수 18~23 영구 ×2 (완전 중복)
    TB('b-dup2', 3, '18:00', '22:00', '구 고정팀 차단', null, null, { created_at: '2026-09-02T00:00:00Z' }),
    TB('b-comm', 3, '14:00', '15:00', '[커뮤니티] 보컬 모임', '2026-11-25', '2026-11-25'),               // 수 14~16 1회
    TB('b-sub', 6, '14:00', '17:00', '[고정팀 대체] 벤더', '2026-11-14', '2026-11-14', { band_claim_id: 'claim-1' }), // 토 14~18 1회 (대체 합주 — 팀 관리가 주인)
    TB('b-show', 5, '10:00', '19:00', '공연 리허설', '2026-11-13', '2026-11-13'),                        // 금 10~20 1회 — 고정팀과 18~20 겹침
  ],
};
const FAKE_SB = `
(function () {
  const T = ${JSON.stringify(TABLES)};
  window.__T = T; window.__sbCalls = [];
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
  const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
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
    state.user = { nickname: '운영자', kakaoId: 'k-me', authType: 'kakao', role: '운영 총괄' };
    loginUI('운영자');
  });
  await p.waitForTimeout(900);
  const inserts = () => p.evaluate(() => window.__sbCalls.filter(c => c.table === 'time_blocks' && c.op === 'insert').map(c => Array.isArray(c.payload) ? c.payload : [c.payload]));
  const resetCalls = () => p.evaluate(() => { window.__sbCalls = []; });
  const formResult = () => p.evaluate(() => document.getElementById('blockFormResult')?.textContent || '');

  // ── 0) 판정 함수 단위 확인 ──
  const unit = await p.evaluate(() => {
    const T = window.__T.time_blocks; const by = (id) => T.find(x => x.id === id);
    const weeklyThu = { day_of_week: 4, start_time: '10:00', end_time: '11:00', start_date: null, end_date: null };
    const r = {};
    r.pastIgnored = timeBlocksOverlap(weeklyThu, by('b-past')) === null;                                   // 지난 1회 차단은 새 반복 차단과 안 겹침
    r.skipDate = timeBlocksOverlap({ day_of_week: 5, start_time: '18:00', end_time: '22:00', start_date: '2026-11-20', end_date: '2026-11-20' }, by('b-band')) === null;
    r.otherFri = !!timeBlocksOverlap({ day_of_week: 5, start_time: '18:00', end_time: '22:00', start_date: '2026-11-27', end_date: '2026-11-27' }, by('b-band'));
    r.timeDisjoint = timeBlocksOverlap({ day_of_week: 5, start_time: '08:00', end_time: '12:00', start_date: null, end_date: null }, by('b-band')) === null;
    r.rangeDisjoint = timeBlocksOverlap({ day_of_week: 1, start_time: '08:00', end_time: '09:00', start_date: '2026-12-01', end_date: '2026-12-31' }, { day_of_week: 1, start_time: '08:00', end_time: '09:00', start_date: '2027-01-05', end_date: null }) === null;
    r.noDowInRange = timeBlocksOverlap({ day_of_week: 5, start_time: '08:00', end_time: '09:00', start_date: '2026-11-09', end_date: '2026-11-12' }, by('b-band')) === null; // 월~목 기간엔 금요일 없음
    r.fullCover = !!blockFullyCovered({ day_of_week: 1, start_time: '08:00', end_time: '08:00', start_date: null, end_date: null }, T);           // 월 08~09 영구 ⊂ b-mon
    r.partialNotCover = blockFullyCovered({ day_of_week: 1, start_time: '08:00', end_time: '10:00', start_date: null, end_date: null }, T) === null; // 10~11 칸이 빈다
    r.onceCoveredByWeekly = !!blockFullyCovered({ day_of_week: 5, start_time: '19:00', end_time: '20:00', start_date: '2026-11-27', end_date: '2026-11-27' }, T);
    r.onceNotCoveredOnSkip = blockFullyCovered({ day_of_week: 5, start_time: '19:00', end_time: '20:00', start_date: '2026-11-20', end_date: '2026-11-20' }, T) === null;
    r.weeklyNotCoveredBySkipping = blockFullyCovered({ day_of_week: 5, start_time: '19:00', end_time: '20:00', start_date: null, end_date: null }, T) === null;   // 밴드 차단은 11/20 을 건너뛰므로 완전히 덮지 못함
    r.dups = findDuplicateBlocks(T).length === 1 && duplicateBlockExtras(findDuplicateBlocks(T)).map(x => x.id).join() === 'b-dup2';
    r.src = [_blockSource(by('b-band')), _blockSource(by('b-sub')), _blockSource(by('b-comm')), _blockSource(by('b-mon'))].join() === 'band,sub,community,admin'
      && _blockLocked(by('b-band')) && _blockLocked(by('b-sub')) && !_blockLocked(by('b-comm')) && !_blockLocked({ reason: '[고정팀] 옛 방식', band_claim_id: null });
    return r;
  });
  Object.entries(unit).forEach(([k, v]) => chk(`판정: ${k}`, v));

  // ── 1) 관리자 시간차단 화면 ──
  await p.evaluate(async () => { await fetchBlocks(); const box = document.createElement('div'); box.id = 'blkTestBox'; document.body.appendChild(box); renderAdminBlocksSection(box); });
  await p.waitForTimeout(200);
  const ui = await p.evaluate(() => {
    const row = (id) => document.getElementById('blk-row-' + id);
    const txt = (id) => row(id)?.textContent.replace(/\s+/g, ' ') || '';
    return {
      bandNoBtns: !!row('b-band') && !row('b-band').querySelector('button') && txt('b-band').includes('팀 관리') && txt('b-band').includes('고정팀') && txt('b-band').includes('건너뜀 11/20'),
      bandWarn: /겹침 · .*공연 리허설/.test(txt('b-band')),
      showWarn: /겹침 · .*\[고정팀\] 벤더/.test(txt('b-show')) && !!row('b-show').querySelector('button'),
      dupChips: [...document.querySelectorAll('.block-list-row.dup')].length === 2 && txt('b-dup1').includes('중복') && !/겹침/.test(txt('b-dup1')),
      dupBtn: (document.getElementById('blockDupAction')?.textContent || '').trim() === '중복 1개 정리',
      commChip: txt('b-comm').includes('커뮤니티') && !!row('b-comm').querySelector('button'),
      subChip: txt('b-sub').includes('대체 합주') && !row('b-sub').querySelector('button') && txt('b-sub').includes('건너뛰기권'),
      past: (document.getElementById('pastBlocksToggleText')?.textContent || '').includes('지난 차단 1개'),
      count: document.getElementById('blockListCount')?.textContent === '8',
      hint: !!document.querySelector('.block-form-hint') && !!document.getElementById('blockFormResult') && !!document.getElementById('blockAddBtn'),
    };
  });
  chk('목록: 고정팀 차단은 수정/삭제 없이 「팀 관리 › [해제]」 안내 + 고정팀 칩 + 건너뜀 날짜', ui.bandNoBtns);
  chk('목록: 고정팀 ↔ 공연 리허설 1회 차단이 서로 「⚠ 겹침」으로 표시', ui.bandWarn && ui.showWarn);
  chk('목록: 완전 중복 2건에 「중복」 칩(겹침 경고는 아님) + 머리 [중복 1개 정리]', ui.dupChips && ui.dupBtn);
  chk('목록: 커뮤니티 칩(버튼 있음) · 대체 합주 칩(버튼 없음, 「건너뛰기권 [삭제]」 안내), 지난 차단 1개 접힘, 총 8개, 폼 안내문·결과칸·버튼 id', ui.commChip && ui.subChip && ui.past && ui.count && ui.hint);

  const setForm = (o) => p.evaluate((o) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('blockRepeat', o.type); onBlockRepeatChange();
    set('blockStart', o.st); set('blockEnd', o.et); set('blockReason', o.reason || '');
    set('blockDow', o.dow != null ? String(o.dow) : '1'); set('blockStartDate', o.sd || ''); set('blockEndDate', o.ed || ''); set('blockSingleDate', o.date || '');
    multiDates = o.multi || []; if (o.type === 'multi') renderMultiDateList();
  }, o);

  // ── 2) 추가: 지난 1회 차단이 있는 요일에 새 반복 차단 → 묻지 않고 추가 ──
  dialogs.length = 0; await resetCalls();
  await setForm({ type: 'weekly', dow: 4, st: '10:00', et: '11:00', reason: '목요일 청소' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(300);
  let ins = await inserts();
  chk('추가: 지난 목요일 1회 차단은 무시 → 매주 목 10~12 추가(확인창 없음, insert 1)', ins.length === 1 && ins[0].length === 1 && ins[0][0].day_of_week === 4 && dialogs.length === 0, `dialogs=${dialogs.length} ins=${JSON.stringify(ins).slice(0, 120)}`);

  // ── 3) 일부 겹침 → 확인창(겹치는 차단 이름) → 추가 ──
  dialogs.length = 0; await resetCalls();
  await setForm({ type: 'once', date: '2026-11-27', st: '10:00', et: '22:00', reason: '공연' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(300);
  ins = await inserts();
  chk('추가: 11/27(금) 10~23 는 고정팀 18~23 과 일부 겹침 → 확인창에 「[고정팀] 벤더」 → 추가됨', dialogs.length === 1 && /일부 시간이 이미 차단/.test(dialogs[0]) && /\[고정팀\] 벤더/.test(dialogs[0]) && ins.length === 1, dialogs[0]?.slice(0, 120));

  // ── 4) 건너뛰는 날의 1회 차단은 겹침 아님 ──
  dialogs.length = 0; await resetCalls();
  await setForm({ type: 'once', date: '2026-11-20', st: '18:00', et: '22:00' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(300);
  ins = await inserts();
  chk('추가: 고정팀이 건너뛰는 11/20(금) 18~23 1회 차단 → 확인창 없이 추가', dialogs.length === 0 && ins.length === 1);

  // ── 5) 완전 중복 → 인라인 오류, insert 없음 ──
  dialogs.length = 0; await resetCalls();
  await setForm({ type: 'weekly', dow: 1, st: '08:00', et: '09:00', reason: '또 점검' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(300);
  ins = await inserts();
  chk('추가: 매주 월 08~10 은 이미 전부 차단 → 인라인 오류(이미 전부 차단된 시간 · 정기 점검), insert 없음', ins.length === 0 && /이미 전부 차단된 시간/.test(await formResult()) && /정기 점검/.test(await formResult()) && dialogs.length === 0, await formResult());

  // ── 6) 여러 날짜: 덮인 날짜만 건너뛰고 나머지 추가 ──
  dialogs.length = 0; await resetCalls();
  await setForm({ type: 'multi', multi: ['2026-11-10', '2026-11-16'], st: '08:00', et: '08:00', reason: '오전 점검' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(300);
  ins = await inserts();
  chk('추가(여러 날짜): 11/16(월) 08~09 는 이미 차단 → 건너뜀, 11/10(화)만 insert + 결과칸 「건너뜀」', ins.length === 1 && ins[0].length === 1 && ins[0][0].start_date === '2026-11-10' && /건너뜀/.test(await formResult()) && /2026-11-16/.test(await formResult()), await formResult());

  // ── 7) 이중 제출 ──
  dialogs.length = 0; await resetCalls();
  await setForm({ type: 'once', date: '2026-12-04', st: '08:00', et: '08:00', reason: '이중 클릭' });
  await p.evaluate(() => { addTimeBlock(); addTimeBlock(); }); await p.waitForTimeout(400);
  ins = await inserts();
  chk('추가: 빠른 두 번 클릭 → insert 1번만(이중 제출 차단)', ins.length === 1, `ins=${ins.length}`);

  // ── 8) 매주 반복 + 기간 검증 ──
  dialogs.length = 0; await resetCalls();
  await setForm({ type: 'weekly', dow: 2, st: '08:00', et: '08:00', sd: '2026-11-16', ed: '2026-11-16' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(200);
  const r8a = await formResult();
  await setForm({ type: 'weekly', dow: 5, st: '08:00', et: '08:00', sd: '2026-11-09', ed: '2026-11-12' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(200);
  const r8b = await formResult();
  ins = await inserts();
  chk('추가: 기간에 해당 요일이 없으면 오류(화요일 1일 기간=월요일 / 금요일 vs 월~목) · insert 없음', /화요일이 없습니다/.test(r8a) && /금요일이 없습니다/.test(r8b) && ins.length === 0, `${r8a} | ${r8b}`);
  await setForm({ type: 'weekly', dow: 1, st: '08:00', et: '08:00', sd: '2026-11-09', ed: '2026-11-01' });
  await p.evaluate(() => addTimeBlock()); await p.waitForTimeout(200);
  chk('추가: 시작일 > 종료일 오류', /늦을 수 없습니다/.test(await formResult()));

  // ── 9) 중복 정리 ──
  dialogs.length = 0; await resetCalls();
  await p.click('#blockDupAction button'); await p.waitForTimeout(400);
  const afterDedupe = await p.evaluate(() => ({
    ids: window.__T.time_blocks.filter(x => x.reason === '구 고정팀 차단').map(x => x.id),
    del: window.__sbCalls.filter(c => c.table === 'time_blocks' && c.op === 'delete').length,
    btn: (document.getElementById('blockDupAction')?.textContent || '').trim(),
    dupRows: document.querySelectorAll('.block-list-row.dup').length,
  }));
  chk('중복 정리: 확인창 → 먼저 만든 b-dup1 만 남고 b-dup2 삭제, 버튼·중복 칩 사라짐', dialogs.length === 1 && /두 번 이상 등록/.test(dialogs[0]) && afterDedupe.ids.join() === 'b-dup1' && afterDedupe.del === 1 && afterDedupe.btn === '' && afterDedupe.dupRows === 0, JSON.stringify(afterDedupe));

  // ── 10) 고정팀 차단은 여기서 삭제 불가 ──
  dialogs.length = 0; await resetCalls();
  await p.evaluate(() => deleteTimeBlock('b-band')); await p.waitForTimeout(300);
  const bandStill = await p.evaluate(() => !!window.__T.time_blocks.find(x => x.id === 'b-band') && window.__sbCalls.filter(c => c.op === 'delete').length === 0);
  chk('삭제: 고정팀 차단은 토스트 안내만(확인창·delete 없음)', bandStill && dialogs.length === 0);
  dialogs.length = 0;
  await p.evaluate(() => deleteTimeBlock('b-comm')); await p.waitForTimeout(300);
  chk('삭제: 커뮤니티 차단은 확인창에 「모임 자체는 남습니다」 안내 뒤 삭제', dialogs.length === 1 && /모임 자체는 남습니다/.test(dialogs[0]) && await p.evaluate(() => !window.__T.time_blocks.find(x => x.id === 'b-comm')));

  // ── 11) 수정: 요일 변경 가능 · 완전 중복은 행 안 오류 ──
  dialogs.length = 0; await resetCalls();
  await p.evaluate(() => { toggleBlockEdit('b-show'); document.getElementById('blk-st-b-show').value = '18:00'; document.getElementById('blk-et-b-show').value = '19:00'; });
  await p.evaluate(() => saveBlockEdit('b-show')); await p.waitForTimeout(300);
  const editErr = await p.evaluate(() => document.getElementById('blk-err-b-show')?.textContent || '');
  const noUpd = await p.evaluate(() => window.__sbCalls.filter(c => c.table === 'time_blocks' && c.op === 'update').length === 0);
  chk('수정: 11/13(금) 18~20 으로 줄이면 고정팀 차단에 완전히 덮임 → 행 안 오류, update 없음', /이미 전부 차단/.test(editErr) && noUpd, editErr);
  await p.evaluate(() => { toggleBlockEdit('b-mon'); document.getElementById('blk-dw-b-mon').value = '2'; });
  await p.evaluate(() => saveBlockEdit('b-mon')); await p.waitForTimeout(300);
  const monNow = await p.evaluate(() => window.__T.time_blocks.find(x => x.id === 'b-mon'));
  chk('수정: 매주 반복 차단의 요일을 월 → 화 로 변경(새 요일 셀렉트)', monNow && monNow.day_of_week === 2, JSON.stringify(monNow));

  // ── 12) 달력 칸: 겹치는 차단은 고정팀이 먼저, 라벨 「+N」, 건너뛰는 날은 그날 1회 차단만 ──
  const cal = await p.evaluate(() => {
    const a = getBlocks(new Date('2026-11-13T00:00:00'), '18:00');
    const b = getBlocks(new Date('2026-11-20T00:00:00'), '18:00');
    return { n: a.length, first: a[0]?.id, label: _blockCellReason(a), skipN: b.length, skipFirst: b[0]?.reason || null };
  });
  chk('달력: 11/13 18시 = 고정팀 + 공연 리허설 2개, 고정팀 먼저, 라벨 「[고정팀] 벤더 +1」 / 11/20 18시 = 새 1회 차단만', cal.n === 2 && cal.first === 'b-band' && cal.label === '[고정팀] 벤더 +1' && cal.skipN === 1 && cal.skipFirst === null, JSON.stringify(cal));

  // ── 13) 고르면 바로 추가(2026-11-08): 여러 날짜 입력·예약 참여 멤버·멤버 수정 모달은 [+ 추가] 없이 change 로 추가, 중복은 토스트(알림창 없음)
  dialogs.length = 0;
  const multi = await p.evaluate(() => {
    multiDates = []; renderMultiDateList();
    const inp = document.getElementById('blockMultiInput');
    const fire = (v) => { inp.value = v; inp.dispatchEvent(new Event('change', { bubbles: true })); };
    fire('2026-12-10'); const afterFirst = { n: multiDates.length, cleared: inp.value === '', chip: document.querySelectorAll('#multiDateList .multi-date-chip').length };
    fire('2026-12-10'); fire('2026-12-03');
    return { afterFirst, list: multiDates.slice(), chips: document.querySelectorAll('#multiDateList .multi-date-chip').length, noBtn: !document.querySelector('#multiOptions button:not(.multi-date-chip button)'), hint: /바로 목록에 추가/.test(document.getElementById('multiOptions').textContent) };
  });
  chk('여러 날짜: 날짜를 고르면(change) 바로 칩 추가 + 입력 비움, 같은 날짜는 안 늘고, 정렬, [+ 추가] 버튼 없음·안내문', multi.afterFirst.n === 1 && multi.afterFirst.cleared && multi.afterFirst.chip === 1 && multi.list.join() === '2026-12-03,2026-12-10' && multi.chips === 2 && multi.noBtn && multi.hint && dialogs.length === 0, JSON.stringify(multi));
  const part = await p.evaluate((ME) => {
    state.currentView = 'week'; state.startTime = '10:00'; state.endTime = '11:00'; state.participantIds = [];
    renderParticipantSelector();
    const sel = document.getElementById('participantSelect');
    const pick = (v) => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); };
    pick('M:' + ME); const one = state.participantIds.slice();
    pick('M:' + ME);
    return { one, two: state.participantIds.slice(), reset: sel.value === '', chip: document.getElementById('participantChips').textContent.includes('운영자'), noBtn: !document.querySelector('#participantSection button.gaa-btn-primary'), hint: /고르면 바로 추가/.test(document.getElementById('participantSection').textContent), hasOnchange: sel.getAttribute('onchange') === 'addParticipantFromSelect()' };
  }, ME);
  chk('예약 참여 멤버: 셀렉트에서 고르면 바로 칩 추가·셀렉트 초기화, 중복은 알림창 없이 토스트, [+ 추가] 버튼 없음·안내문', part.one.length === 1 && part.two.length === 1 && part.reset && part.chip && part.noBtn && part.hint && part.hasOnchange && dialogs.length === 0, JSON.stringify(part));
  const edit = await p.evaluate((ME) => {
    state.editingResParticipantIds = []; renderEditParticipantSelector();
    const sel = document.getElementById('editParticipantSelect');
    sel.value = 'M:' + ME; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ids: state.editingResParticipantIds.slice(), chip: document.getElementById('editParticipantChips').textContent.includes('운영자'), noBtn: !document.querySelector('#editParticipantsModal button[onclick="addEditParticipant()"]'), hasOnchange: sel.getAttribute('onchange') === 'addEditParticipant()' };
  }, ME);
  chk('참여 멤버 수정 모달: 고르면 바로 추가, [+ 추가] 버튼 없음', edit.ids.length === 1 && edit.chip && edit.noBtn && edit.hasOnchange, JSON.stringify(edit));

  // ── 14) 2026-11-09 전체 QA 후속: 취향 파싱 내성·참여횟수 대관 제외·주간 7일 한 화면·탭 타깃·문서 빠른 추가 경로·예약 인라인 안내
  const qa = await p.evaluate(() => {
    const r = {};
    r.tasteObj = (() => { try { return musicTasteTags({ artists: ['A', 'B'], genres: ['록'], songs: [] }).includes('A') && musicTasteTags(JSON.stringify({ artists: 'C, D' })).includes('D') && parseMusicTaste({ artists: 'x' }).artists === 'x'; } catch (e) { return 'err ' + e.message; } })();
    state.reservations = [{ id: 'r1', res_date: '2026-11-20', start_time: '10:00', end_time: '11:00', status: 'approved', participant_ids: [] }, { id: 'perf-x', __perf: true, res_date: '2026-11-20', start_time: '12:00', end_time: '13:00', status: 'approved' }];
    r.statsBase = state.reservations.filter(x => !x.__perf && (x.status === 'approved' || x.status === 'pending')).length;
    return r;
  });
  chk('음악 취향: 객체/배열로 와도 칩을 그린다(멤버 목록·마이가 멈추지 않음)', qa.tasteObj === true, String(qa.tasteObj));
  await p.evaluate(() => { setGatheOTab('member'); setMemberTab('stats'); }); await p.waitForTimeout(900);
  chk('참여횟수: 「예약 (전체)」 건수에 공간 대관 가상 행 제외', await p.evaluate(() => /예약 \(전체\)\s*1건/.test(document.getElementById('memberPanelContent')?.textContent.replace(/\s+/g, ' ') || '')), await p.evaluate(() => (document.getElementById('memberPanelContent')?.textContent.replace(/\s+/g, ' ') || '').slice(0, 80)));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { setGatheOTab('reservation'); const t = document.querySelector('.tab[data-view="week"]'); if (t) t.click(); state.viewDate = new Date('2026-11-13T00:00:00'); render(); }); await p.waitForTimeout(500);
  const wk = await p.evaluate(() => { const g = document.querySelector('.weekly-grid'); const vc = document.getElementById('viewContainer'); const cells = [...document.querySelectorAll('.weekly-header-cell')].map(e => e.textContent.replace(/\s+/g, ' ').trim()); return { gridW: Math.round(g.getBoundingClientRect().width), boxW: Math.round(vc.getBoundingClientRect().width), scroll: vc.scrollWidth - vc.clientWidth, heads: cells.length, blockedShort: [...new Set([...document.querySelectorAll('.slot-blocked')].map(e => e.textContent.trim()))] }; });
  chk('주간 시간표(390px): 7일이 가로 스크롤 없이 한 화면 + 차단 칸은 짧은 라벨(고정팀)', wk.gridW <= wk.boxW && wk.scroll <= 1 && wk.heads >= 8 && wk.blockedShort.some(t => /고정팀/.test(t) && !/\[고정팀\]/.test(t)), JSON.stringify(wk));
  await p.evaluate(() => { onSlotClick(new Date('2026-11-13T00:00:00'), '10:00'); onSlotClick(new Date('2026-11-13T00:00:00'), '11:00'); }); await p.waitForTimeout(300);
  const chipX = await p.evaluate(() => { const b = document.querySelector('#participantChips button'); return b ? [b.offsetWidth, b.offsetHeight] : null; });
  chk('참여 멤버 칩의 × 는 24px 탭 타깃', chipX && chipX[0] >= 24 && chipX[1] >= 24, JSON.stringify(chipX));
  await p.evaluate(() => setGatheOTab('home')); await p.waitForTimeout(500);
  const homeBtn = await p.evaluate(() => { const b = document.querySelector('.gt-sec button'); return b ? b.offsetHeight : 0; });
  chk('홈 「전체 보기 ›」 버튼 높이 ≥ 32px', homeBtn >= 32, String(homeBtn));
  dialogs.length = 0;
  await p.evaluate(() => quickAddDoc()); await p.waitForTimeout(700);
  chk('운영안내 [+ 새 문서 추가]: prompt 없이 관리자 › 문서관리 편집기로 이동', dialogs.length === 0 && await p.evaluate(() => state.adminTab === 'docs' && state.gatheoTab === 'admin' && !!document.getElementById('newDocTitle')));
  await p.evaluate(() => { setGatheOTab('reservation'); state.selectedDate = null; state.startTime = null; const f = document.getElementById('reservationForm'); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }); await p.waitForTimeout(400);
  chk('예약 폼 검증은 알림창 대신 인라인(#reserveResult)', dialogs.length === 0 && await p.evaluate(() => { const r = document.getElementById('reserveResult'); return !!r && r.classList.contains('on') && /날짜와 시간/.test(r.textContent); }));

  // ── 15) 관리자 오류는 토스트 · 게시판 필수 표시 · 권한표 카드형(폰)
  dialogs.length = 0;
  await p.evaluate(() => { setGatheOTab('admin'); state.adminTab = 'notice'; renderGatheOAdmin(); }); await p.waitForTimeout(600);
  await p.evaluate(() => { document.getElementById('noticeTitle').value = ''; document.getElementById('noticeContent').value = ''; postNotice(); }); await p.waitForTimeout(300);
  const toastTxt = await p.evaluate(() => (document.getElementById('auto-toast') || {}).textContent || '');
  chk('관리자 공지 검증: 알림창 없이 토스트(제목과 내용)', dialogs.length === 0 && /제목과 내용/.test(toastTxt), toastTxt);
  await p.evaluate(() => { setGatheOTab('board'); const f = document.getElementById('boardWriteForm'); if (f) f.style.display = 'block'; document.getElementById('boardTitleInput').value = ''; document.getElementById('commentInput').value = '본문만'; postComment(); }); await p.waitForTimeout(300);
  chk('게시판: 제목·내용 라벨에 필수(*) 표시 + 빈 제목은 빨간 테두리·포커스, 알림창 없음', dialogs.length === 0 && await p.evaluate(() => document.querySelectorAll('#boardWriteForm .gt-field-label em').length === 2 && document.getElementById('boardTitleInput').classList.contains('gt-field-err') && document.activeElement === document.getElementById('boardTitleInput')));
  await p.evaluate(() => { const i = document.getElementById('boardTitleInput'); i.value = '제목'; i.dispatchEvent(new Event('input')); });
  chk('게시판: 입력하면 빨간 테두리 해제', await p.evaluate(() => !document.getElementById('boardTitleInput').classList.contains('gt-field-err')));
  await p.evaluate(() => { setGatheOTab('admin'); state.adminTab = 'members'; renderGatheOAdmin(); }); await p.waitForTimeout(900);
  const roles390 = await p.evaluate(() => ({ cards: document.querySelectorAll('.role-card').length, cardsVisible: getComputedStyle(document.querySelector('.role-cards')).display !== 'none', tableVisible: getComputedStyle(document.querySelector('.role-table-wrap')).display !== 'none', first: document.querySelector('.role-card')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 60), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  await p.setViewportSize({ width: 820, height: 1000 }); await p.waitForTimeout(200);
  const roles820 = await p.evaluate(() => ({ cardsVisible: getComputedStyle(document.querySelector('.role-cards')).display !== 'none', tableVisible: getComputedStyle(document.querySelector('.role-table-wrap')).display !== 'none' }));
  await p.setViewportSize({ width: 420, height: 950 });
  chk('권한표: 폰(390px)은 기능별 카드 15장(표 숨김) · 820px 은 표(카드 숨김)', roles390.cards === 15 && roles390.cardsVisible && !roles390.tableVisible && !roles390.overflow && !roles820.cardsVisible && roles820.tableVisible && /합주실 예약 신청.*운영 총괄/.test(roles390.first), JSON.stringify({ roles390, roles820 }));

  chk('pageerror 없음', errs.length === 0, errs.join(' | ').slice(0, 200));
  await br.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
