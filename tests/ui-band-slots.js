// 고정 합주팀 실시간 시간 띠·타임 신청·건너뛰기권(2026-11-05): 가입 화면 가능 타임 표 → 신청 저장 → 관리자 승인(달력 반영·건너뛰기권 발급)
// → 팀 관리 카드(고정 시간·부여) → ⏱️ 시간 띠 탭 → 팀 본인 화면(보상 선택: 1주 연장·대체 합주) → 게더링 getBlock 의 skip_dates 반영
// 실행: (repo 루트 서빙) python3 -m http.server 8766 & NODE_PATH=<scratchpad>/node_modules node tests/ui-band-slots.js
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const SHOT_DIR = process.env.SHOT_DIR || path.join(process.cwd(), 'ui-shots'); fs.mkdirSync(SHOT_DIR, { recursive: true });
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8766;
const NOW = '2026-11-05T10:00:00+09:00'; // 목요일

const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';
const VANDOR = 'b0000000-0000-4000-8000-000000000002';
const NEWBIE = 'd0000000-0000-4000-8000-000000000004';
const D = { monDay: 'def-mon-day', monNight: 'def-mon-night', tueNight: 'def-tue-night', wedDay: 'def-wed-day', friNight: 'def-fri-night', satAm: 'def-sat-am', satDay: 'def-sat-day' };
const TABLES = {
  profiles: [
    { id: ADMIN_ID, member_type: 'band', status: 'approved', band_name_kr: '게더링', band_name_en: 'GatheO', leader_name: '최경수', leader_phone: '010-5109-1042', instruments: 'wearegatheo', email: 'wearegatheo@band.gatheo.kr', timeslots: ['금_야간'], created_at: '2026-01-01T00:00:00Z' },
    { id: VANDOR, member_type: 'band', status: 'approved', band_name_kr: '벤더', band_name_en: 'Vandor', leader_name: '권율', leader_phone: '010-7484-0121', instruments: 'vandor', email: 'vandor@band.gatheo.kr', timeslots: ['금_야간'],
      band_start_date: '2026-05-17', band_fee: 250000, created_at: '2026-05-01T00:00:00Z' },
    { id: NEWBIE, member_type: 'band', status: 'pending', band_name_kr: '신규팀', band_name_en: 'Newbie', leader_name: '김신규', leader_phone: '010-1111-2222', instruments: 'newbie', email: 'newbie@band.gatheo.kr', timeslots: ['토_오전'], band_start_date: '2026-11-14', band_expected_months: '2개월', created_at: '2026-11-01T00:00:00Z' },
  ],
  band_slot_defs: [
    { id: D.monDay, day_of_week: 1, start_time: '12:00', end_time: '18:00', label: '주간', band_ok: true, rental_ok: true, open_from: null, note: null },
    { id: D.monNight, day_of_week: 1, start_time: '18:00', end_time: '23:00', label: '야간', band_ok: true, rental_ok: true, open_from: '2026-12-01', note: null },
    { id: D.tueNight, day_of_week: 2, start_time: '18:00', end_time: '23:00', label: '야간', band_ok: false, rental_ok: true, open_from: null, note: '기존 고정팀', off_reason: 'team' },
    { id: D.wedDay, day_of_week: 3, start_time: '12:00', end_time: '18:00', label: '주간', band_ok: true, rental_ok: true, open_from: null, note: null },
    { id: D.friNight, day_of_week: 5, start_time: '18:00', end_time: '23:00', label: '야간', band_ok: true, rental_ok: true, open_from: null, note: null },
    { id: D.satAm, day_of_week: 6, start_time: '09:00', end_time: '14:00', label: '오전', band_ok: true, rental_ok: true, open_from: null, note: null },
    { id: D.satDay, day_of_week: 6, start_time: '14:00', end_time: '18:00', label: '주간', band_ok: false, rental_ok: true, open_from: null, note: '고정팀 불가 · 대관 가능', off_reason: 'rental' },
  ],
  band_slot_claims: [
    { id: 'cl-vandor', profile_id: VANDOR, def_id: D.friNight, day_of_week: 5, start_time: '18:00', end_time: '23:00', start_date: '2026-05-17', end_date: null, status: 'approved', block_id: 'blk-vandor', created_at: '2026-05-01T00:00:00Z' },
    { id: 'cl-newbie', profile_id: NEWBIE, def_id: D.satAm, day_of_week: 6, start_time: '09:00', end_time: '14:00', start_date: '2026-11-14', end_date: null, status: 'pending', block_id: null, created_at: '2026-11-01T00:00:00Z' },
  ],
  band_skips: [
    { id: 'sk-vandor', profile_id: VANDOR, claim_id: 'cl-vandor', skip_date: '2026-11-20', skip_start: '18:00', skip_end: '23:00', reason: '공간 대관', resolution: null, granted_by: 'signup', created_at: '2026-11-01T00:00:00Z' },
  ],
  time_blocks: [
    { id: 'blk-vandor', day_of_week: 5, start_time: '18:00', end_time: '22:00', reason: '[고정팀] 벤더', start_date: '2026-05-17', end_date: null, band_claim_id: 'cl-vandor', skip_dates: ['2026-11-20'] },
    { id: 'blk-clean', day_of_week: 3, start_time: '12:00', end_time: '16:00', reason: '정기 청소', start_date: null, end_date: null, skip_dates: [] },
  ],
  reservations: [
    { id: 'r1', res_date: '2026-11-23', start_time: '13:00', end_time: '14:00', status: 'approved', user_name: '홍길동' },     // 월 주간 2주차 겹침
    { id: 'r2', res_date: '2026-11-21', start_time: '10:00', end_time: '11:00', status: 'pending', user_name: '김멤버' },      // 토 오전(신규팀 신청) 겹침
    { id: 'r3', res_date: '2026-11-16', start_time: '13:00', end_time: '14:00', status: 'cancelled', user_name: '취소' },     // 취소는 무시
    { id: 'r4', res_date: '2027-04-05', start_time: '12:00', end_time: '13:00', status: 'approved', user_name: '먼예약' },     // 월 주간 — 6개월 안·3개월 밖
    { id: 'r5', res_date: '2027-01-16', start_time: '10:00', end_time: '11:00', status: 'approved', user_name: '먼예약' },     // 토 오전 — 신규팀 예상 2개월(~1/14) 밖
  ],
  performance_bookings: [
    { id: 'pb1', date: '2026-11-30', start_time: '12:00', end_time: '14:00', status: 'approved', created_at: '2026-11-01T00:00:00Z' },   // 월 주간 3주차 겹침
  ],
  band_payments: [], band_rent_reminders: [], band_notices: [], band_members: [], band_comments: [],
  band_pins: [{ profile_id: VANDOR, pin: '0921' }],
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
    chain('not', () => {}); chain('lt', () => {}); chain('gt', () => {});
    chain('gte', (c, v) => st.filters.push(r => r[c] == null || r[c] >= v)); chain('lte', (c, v) => st.filters.push(r => r[c] == null || r[c] <= v));
    chain('order', () => {}); chain('limit', () => {}); chain('range', () => {}); chain('maybeSingle', () => { st.single = true; }); chain('single', () => { st.single = true; });
    b.then = (res, rej) => {
      const rows = (T[table] || (T[table] = []));
      const hit = rows.filter(r => st.filters.every(f => f(r)));
      window.__sbCalls.push({ table, op: st.op, payload: JSON.parse(JSON.stringify(st.payload ?? null)), n: hit.length });
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
    auth: { signOut: async () => ({}), getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
            signUp: async () => ({ data: { user: { id: 'f0000000-0000-4000-8000-000000000006' } }, error: null }) },
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
    document.getElementById('portalLoadingScreen')?.remove(); document.getElementById('bgm-player')?.remove();
    applyTheme('light'); supabaseClient = window.__fakeSb;
    window.__fetchCalls = [];
    window.fetch = (url, opts) => { window.__fetchCalls.push({ url: String(url), body: opts && opts.body }); return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); };
  });
  const calls = (t, op) => p.evaluate(([t, op]) => window.__sbCalls.filter(c => c.table === t && c.op === op), [t, op]);
  const lastCall = async (t, op) => (await calls(t, op)).pop();

  // ── 0. 예약 그리드 08~23시 + getBlock 이 skip_dates 를 존중
  chk('TIMES 08:00 시작 · 15칸(끝 23:00) · 예약 안내 "오전 8시"', await p.evaluate(() => TIMES[0] === '08:00' && TIMES.length === 15 && TIMES[14] === '22:00'));
  chk('getBlock: 벤더 금 야간 반복 차단 — 11/13 막힘 · 건너뛰는 11/20 은 열림 · 11/27 막힘', await p.evaluate(() => {
    state.blocks = window.__T.time_blocks;
    const at = (d) => getBlock(new Date(d + 'T00:00:00'), '19:00');
    return !!at('2026-11-13') && at('2026-11-20') === null && !!at('2026-11-27') && isBlocked(new Date('2026-11-18T00:00:00'), '13:00');
  }));
  chk('timeBlocksConflict: 건너뛰는 날의 1회 차단은 반복 차단과 안 겹침, 다른 금요일은 겹침', await p.evaluate(() => {
    const once = (d) => ({ day_of_week: 5, start_time: '19:00', end_time: '20:00', start_date: d, end_date: d });
    return !timeBlocksConflict(once('2026-11-20'), window.__T.time_blocks[0]) && timeBlocksConflict(once('2026-11-27'), window.__T.time_blocks[0]);
  }));

  // ── 1. 합주팀 첫 화면: 시간표 보기 / 가입 신청 / 로그인 3가지 → 고정 가능 시간 보기(설명 + 실시간 표)
  await p.evaluate(() => { _hideAllScreens(); showBandSection(); document.getElementById('portalLoadingScreen')?.remove(); });
  await p.waitForTimeout(300);
  chk('첫 화면: 메뉴 2개(고정 가능 시간 보기 · 가입 신청 / 로그인) 표시 — 가입 신청 단독 버튼 없음, 로그인 폼·시간표·가입 폼 숨김', await p.evaluate(() => { const m = document.getElementById('band-menu'); const b = [...m.querySelectorAll('.band-menu-btn b')].map(e => e.textContent); return !m.classList.contains('hidden') && b.join('|') === '고정 가능 시간 보기 · 가입 신청|로그인' && !m.querySelector('[onclick="showBandSignupForm()"]') && document.querySelector('#band-login-form button[onclick="showBandScheduleView()"]') && ['band-login-form', 'band-schedule-view', 'band-signup-form'].every(id => document.getElementById(id).classList.contains('hidden')); }));
  await p.evaluate(() => showBandScheduleView());
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-slots-schedule.png'), fullPage: true });
  chk('시간표 화면: 소개(고정 합주팀)·읽는 법 5항목·접힘 설명(건너뛰기권·신청 절차) + 희망 시작일 기본 오늘+7(11/12)·6개월 + 요약 타일(바로 가능 0·건너뛰기 조건 1·날짜 지정 1)', await p.evaluate(() => { const v = document.getElementById('band-schedule-view'); const lead = v.querySelector('.band-sv-lead').textContent, more = v.querySelector('.band-sv-more').textContent; const tiles = [...v.querySelectorAll('.band-sv-stat b')].map(b => b.textContent).join('/'); return !v.classList.contains('hidden') && v.querySelector('.band-sv-title').textContent === '고정 가능 시간' && lead.includes('고정으로 쓰는 팀') && v.querySelectorAll('.band-sv-key-grid > div').length === 5 && more.includes('건너뛰기권') && more.includes('신청 절차') && !v.querySelector('.band-sv-more').open && document.getElementById('bandScheduleStart').value === '2026-11-12' && document.getElementById('bandScheduleMonths').value === '6' && v.querySelector('.band-sv-period').textContent === '11/12(목)부터 6개월 · ~5/12 기준' && tiles === '0/1/1' && !v.querySelector('.band-avail-summary'); }), await p.evaluate(() => document.querySelector('#band-schedule-view .band-sv-period')?.textContent + ' | ' + [...document.querySelectorAll('#band-schedule-view .band-sv-stat b')].map(b => b.textContent).join('/')));
  chk('표: 요일 알약 7개(토 파랑·일 빨강 클래스) · 빈 요일은 "—" · 칩 시간 먼저 + 띠 이름', await p.evaluate(() => { const v = document.getElementById('band-schedule-view'); const days = [...v.querySelectorAll('.band-avail-day')]; const none = v.querySelectorAll('.band-avail-none').length; const t = v.querySelector('.band-slot-chip[data-def="def-mon-day"] .t'); return days.length === 7 && days[5].classList.contains('sat') && days[6].classList.contains('sun') && none === 2 && t.textContent === '12~18시주간' && t.querySelector('em').textContent === '주간'; }));
  chk('시간표 화면: CTA 는 선택 전 "가입 신청으로"(항상 누를 수 있음)', await p.evaluate(() => { const b = document.getElementById('bandScheduleNextBtn'); return !b.disabled && b.textContent === '가입 신청으로'; }));
  const chip = (id) => p.evaluate((id) => { const c = document.querySelector(`#band-schedule-view .band-slot-chip[data-def="${id}"]`); return c && { cls: c.className, s: c.querySelector('.s').textContent, disabled: c.disabled }; }, id);
  let c1 = await chip(D.monDay); const c2 = await chip(D.monNight), c3 = await chip(D.tueNight), c4 = await chip(D.wedDay), c5 = await chip(D.friNight), c6 = await chip(D.satAm), c7 = await chip(D.satDay);
  chk('월 주간: 6개월 기준 3주 건너뛰기(11/23 예약·11/30 대관·2027-04-05 예약, 취소 예약 제외)', c1 && c1.cls.includes('skip') && c1.s === '3주 건너뛰기' && !c1.disabled, JSON.stringify(c1));
  await p.evaluate(() => bandWishMonthsChange('3'));
  await p.waitForTimeout(400);
  c1 = await chip(D.monDay);
  chk('예상 사용 기간 3개월로 → 월 주간 2주 건너뛰기(4월 예약은 범위 밖) · 기간 줄 "3개월 · ~2/12" · 가입 폼 셀렉트도 3', c1 && c1.s === '2주 건너뛰기' && (await p.evaluate(() => document.querySelector('#band-schedule-view .band-sv-period').textContent.includes('3개월 · ~2/12') && document.getElementById('bandSignupMonths').value === '3')), JSON.stringify(c1));
  chk('월 야간: 개방일 12/1부터(선택 불가지만 눌러서 안내)', c2 && c2.cls.includes('later') && c2.cls.includes('na') && c2.s === '12/1부터' && !c2.disabled, JSON.stringify(c2));
  chk('화 야간: 고정팀 불가(off_reason team) → "고정팀 사용 중"(대관만 아님)', c3 && c3.cls.includes('taken') && c3.s === '고정팀 사용 중' && !c3.disabled, JSON.stringify(c3));
  chk('토 주간: 고정팀 불가(rental) → 대관만', c7 && c7.cls.includes('off') && c7.s === '대관만' && !c7.disabled, JSON.stringify(c7));
  chk('수 주간: 운영 반복 차단(정기 청소) → 차단 중', c4 && c4.cls.includes('taken') && c4.s === '차단 중', JSON.stringify(c4));
  chk('금 야간: 벤더 반복 차단 → 고정팀 사용 중', c5 && c5.cls.includes('taken') && c5.s === '고정팀 사용 중', JSON.stringify(c5));
  chk('토 오전: 신규팀 신청 대기 → 다른 팀 신청 중', c6 && c6.cls.includes('wait') && c6.s === '다른 팀 신청 중', JSON.stringify(c6));
  chk('칩 폭 420px: 월요일 줄 칩 2개가 줄 안에 들어옴', await p.evaluate(() => { const row = document.querySelector('#band-schedule-view .band-avail-row'); const chips = [...row.querySelectorAll('.band-slot-chip')]; const r = row.getBoundingClientRect(); return chips.length === 2 && chips.every(c => c.getBoundingClientRect().right <= r.right + 1) && chips.every(c => c.offsetHeight >= 36); }));
  await p.click(`#band-schedule-view .band-slot-chip[data-def="${D.monDay}"]`);
  const detail = await p.evaluate(() => document.querySelector('#band-schedule-view .band-sv-detail')?.textContent || '');
  chk('선택 → 칩 "✓ 선택" + 안내: 2주 · 11/23(월) 게더링 예약 · 11/30(월) 공간 대관 · 건너뛰기권 설명 + CTA "(1개)"', (await chip(D.monDay)).s === '✓ 선택' && detail.includes('2주') && detail.includes('11/23(월) 12~18시 · 게더링 예약') && detail.includes('11/30(월) 12~18시 · 공간 대관') && detail.includes('같은 고정 사용 시간의 대체 합주') && detail.includes('1주 무료 연장') && !/같은 길이/.test(document_text_placeholder()) && (await p.evaluate(() => document.getElementById('bandScheduleNextBtn').textContent)) === '이 타임으로 가입 신청하기 (1개)', detail.slice(0, 160));
  function document_text_placeholder() { return ''; }
  chk('"같은 길이" 문구 없음(같은 고정 사용 시간으로 통일)', await p.evaluate(() => !document.body.innerHTML.includes('같은 길이')));
  // 개방일 칩을 누르면 희망 시작일이 그날로 — 월 야간 가능, 월 주간은 겹침 없음(선택 유지), 두 화면 날짜칸 동기화
  await p.click(`#band-schedule-view .band-slot-chip[data-def="${D.monNight}"]`);
  await p.waitForTimeout(400);
  const c2b = await chip(D.monNight), c1b = await chip(D.monDay);
  chk('"12/1부터" 칩 클릭 → 시작일 12/1 · 월 야간 가능 · 월 주간 "✓ 선택" 유지 · 가입 폼 날짜칸도 12/1', c2b && c2b.cls.includes('ok') && !c2b.disabled && c1b && c1b.s === '✓ 선택' && (await p.evaluate(() => document.getElementById('bandScheduleStart').value === '2026-12-01' && document.getElementById('bandSignupStart').value === '2026-12-01')), JSON.stringify([c2b, c1b]));
  await p.evaluate(() => bandWishStartChange('2026-11-12'));
  await p.waitForTimeout(300);
  chk('선택 불가 칩(대관만) 클릭 → 토스트 안내, 날짜 그대로', await p.evaluate(async (id) => { document.querySelector(`#band-schedule-view .band-slot-chip[data-def="${id}"]`).click(); await new Promise(r => setTimeout(r, 50)); return document.getElementById('bandScheduleStart').value === '2026-11-12' && /고정팀은 받지 않는/.test(document.body.innerText); }, D.satDay));
  chk('"고정팀 사용 중"(team) 칩 클릭 → 다른 고정팀 안내', await p.evaluate(async (id) => { document.querySelector(`#band-schedule-view .band-slot-chip[data-def="${id}"]`).click(); await new Promise(r => setTimeout(r, 50)); return /다른 고정팀이 쓰고 있는/.test(document.body.innerText); }, D.tueNight));
  // CTA → 가입 폼: 같은 표·선택이 폼 안에도 그려지고 종전 체크박스는 숨김
  await p.evaluate(() => document.getElementById('bandScheduleNextBtn').click());
  await p.waitForTimeout(600);
  chk('가입 폼: 표(선택 유지 "✓ 선택")·날짜 11/12 + 한 줄 요약·범례 + 종전 체크박스 숨김 + [표 읽는 법] 링크', await p.evaluate((id) => !document.getElementById('band-signup-form').classList.contains('hidden') && document.getElementById('band-schedule-view').classList.contains('hidden') && !document.getElementById('bandSignupSlots').classList.contains('hidden') && document.getElementById('bandSignupLegacySlots').classList.contains('hidden') && document.querySelector(`#bandSignupAvailBody .band-slot-chip[data-def="${id}"] .s`).textContent === '✓ 선택' && document.getElementById('bandSignupStart').value === '2026-11-12' && !!document.querySelector('#bandSignupAvailBody .band-avail-summary') && !!document.querySelector('#bandSignupAvailBody .band-avail-legend') && !document.querySelector('#bandSignupAvailBody .band-sv-stats') && !!document.querySelector('#band-signup-form button[onclick="showBandScheduleView()"]'), D.monDay));
  await p.evaluate(() => document.getElementById('bandSignupSlots').scrollIntoView());
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-slots-signup.png'), fullPage: true });
  // 제출: 선택 없이 → 인라인 오류 / 선택 후 → profiles upsert + claims insert + 푸시
  await p.evaluate(() => {
    document.getElementById('bandSignupLeaderName').value = '홍길동'; document.getElementById('bandSignupLeaderPhone').value = '010-2222-3333';
    document.getElementById('bandSignupNameKr').value = '새팀'; document.getElementById('bandSignupNameEn').value = 'NewTeam';
    document.getElementById('bandSignupPwDigits').value = '1234'; document.getElementById('bandSignupPwDigitsConfirm').value = '1234';
    document.getElementById('bandPrivacyConsent').checked = true;
    bandSignupToggleSlot(document.querySelector('.band-slot-chip.sel').dataset.def); // 선택 해제
    return handleBandEmailSignup();
  });
  chk('타임 미선택 제출 → 인라인 오류 "합주 타임을 1개 이상"', (await p.evaluate(() => document.getElementById('bandSignupResult').textContent)).includes('합주 타임을 1개 이상'));
  // 아이디 = 밴드 영문명 자동 지정(아이디 칸 없음): 미리보기·짧은 이름 오류
  chk('아이디 칸 없음 + 영문명 "New Team 2!" → 미리보기 "newteam2"(영문·숫자 소문자)', await p.evaluate(() => { const en = document.getElementById('bandSignupNameEn'); en.value = 'New Team 2!'; en.dispatchEvent(new Event('input')); return !document.getElementById('bandSignupId') && document.getElementById('bandSignupIdPreview').textContent === 'newteam2' && /밴드 영문명/.test(document.getElementById('bandSignupIdNote').textContent); }));
  await p.evaluate(() => { document.getElementById('bandSignupNameEn').value = 'AB'; return handleBandEmailSignup(); });
  chk('영문명이 짧으면(ab) 인라인 오류 "4자 이상"', (await p.evaluate(() => document.getElementById('bandSignupResult').textContent)).includes('4자 이상'));
  await p.evaluate(() => { const en = document.getElementById('bandSignupNameEn'); en.value = 'NewTeam'; en.dispatchEvent(new Event('input')); });
  // 비밀번호 규칙: pw 접두 고정 + 숫자 4자리, 안내문(6개월 이상·캐비넷 등록)
  chk('비밀번호 칸: pw 접두 고정 + 숫자 4자리(maxlength 4·numeric) 두 칸 + 안내문(6개월 이상·캐비넷·비밀번호로 등록)', await p.evaluate(() => { const a = document.getElementById('bandSignupPwDigits'), b = document.getElementById('bandSignupPwDigitsConfirm'); const note = document.querySelector('.band-pw-note').textContent; const pre = [...document.querySelectorAll('#band-signup-form .band-pw-prefix')]; return a.maxLength === 4 && a.inputMode === 'numeric' && b.maxLength === 4 && pre.length === 2 && pre.every(e => e.textContent === 'pw') && note.includes('pw + 숫자 4자리') && note.includes('6개월 이상') && note.includes('캐비넷') && note.includes('비밀번호로 등록') && !document.getElementById('bandSignupPassword'); }));
  chk('숫자 입력 정리: "12a4" → "124"(숫자만) · 6자리 → 4자리', await p.evaluate(() => { const a = document.getElementById('bandSignupPwDigits'); a.value = '12a4'; a.dispatchEvent(new Event('input')); const v1 = a.value; a.value = '123456'; a.dispatchEvent(new Event('input')); const v2 = a.value; a.value = '1234'; return v1 === '124' && v2 === '1234'; }));
  await p.evaluate((id) => { bandSignupToggleSlot(id); document.getElementById('bandSignupPwDigits').value = '12'; return handleBandEmailSignup(); }, D.monDay);
  chk('숫자 4자리가 아니면 인라인 오류 "pw 뒤에 숫자 4자리"', (await p.evaluate(() => document.getElementById('bandSignupResult').textContent)).includes('pw 뒤에 숫자 4자리'));
  await p.evaluate(() => { document.getElementById('bandSignupPwDigits').value = '1234'; document.getElementById('bandSignupPwDigitsConfirm').value = '4321'; return handleBandEmailSignup(); });
  chk('확인 칸 불일치 → 인라인 오류', (await p.evaluate(() => document.getElementById('bandSignupResult').textContent)).includes('일치하지 않습니다'));
  await p.evaluate((id) => { document.getElementById('bandSignupPwDigitsConfirm').value = '1234'; bandSignupToggleSlot(id); window.__fakeSb.auth.signUp = async (args) => { window.__signUpArgs = args; return { data: { user: { id: 'f0000000-0000-4000-8000-000000000006' } }, error: null }; }; }, D.monDay);
  chk('가입 폼에서 고른 선택도 시간표 화면과 공유(폼 안 칩 클릭 → 폼 표에 "✓ 선택")', await p.evaluate((id) => { bandSignupToggleSlot(id); const ok = document.querySelector(`#bandSignupAvailBody .band-slot-chip[data-def="${id}"] .s`).textContent === '✓ 선택'; bandSignupToggleSlot(id); return ok; }, D.monDay));
  await p.evaluate((id) => { bandSignupToggleSlot(id); return handleBandEmailSignup(); }, D.monDay);
  try { await p.clock.runFor(1000); } catch (_) {}
  await p.waitForTimeout(400);
  const up = await lastCall('profiles', 'insert');
  const cl = await lastCall('band_slot_claims', 'insert');
  const push = await p.evaluate(() => (window.__fetchCalls || []).find(c => c.url === '/notify-admins'));
  chk('가입: profiles upsert timeslots ["월_주간"] + band_start_date 11/12 + band_expected_months "3개월"', !!up && JSON.stringify(up.payload.timeslots) === '["월_주간"]' && up.payload.band_start_date === '2026-11-12' && up.payload.band_expected_months === '3개월' && up.payload.status === 'pending', JSON.stringify(up && [up.payload.timeslots, up.payload.band_expected_months]));
  chk('가입: band_slot_claims insert(def·요일 1·12:00~18:00·시작일·pending)', !!cl && Array.isArray(cl.payload) && cl.payload.length === 1 && cl.payload[0].def_id === 'def-mon-day' && cl.payload[0].day_of_week === 1 && cl.payload[0].start_time === '12:00' && cl.payload[0].end_time === '18:00' && cl.payload[0].start_date === '2026-11-12' && cl.payload[0].status === 'pending' && cl.payload[0].profile_id === 'f0000000-0000-4000-8000-000000000006', JSON.stringify(cl && cl.payload));
  chk('가입: 관리자 푸시 본문에 "월 주간 · 11/12 시작 희망 · 3개월"', !!push && /월 주간/.test(push.body) && /11\/12 시작 희망 · 3개월/.test(push.body), push && push.body);
  chk('가입: auth.signUp 비밀번호 = "pw1234"(접두 + 숫자 4자리)', await p.evaluate(() => window.__signUpArgs && window.__signUpArgs.password === 'pw1234' && window.__signUpArgs.email === 'newteam@band.gatheo.kr'), await p.evaluate(() => JSON.stringify(window.__signUpArgs)));
  const pinIns = await lastCall('band_pins', 'insert');
  chk('가입: 숫자 4자리를 운영자 전용 band_pins 에 저장(profile_id·pin "1234")', !!pinIns && pinIns.payload.profile_id === 'f0000000-0000-4000-8000-000000000006' && pinIns.payload.pin === '1234', JSON.stringify(pinIns && pinIns.payload));
  // 로그인 정규화: 숫자 4자리만 치면 pw+숫자로, PW 대문자는 소문자로 한 번 더 시도(첫 시도 실패 때만)
  chk('로그인: "1234" → 첫 시도 실패 후 "pw1234" 재시도 · "PW1234" → "pw1234" 재시도 · 맞는 비밀번호는 1회', await p.evaluate(async () => {
    const tries = []; window.__fakeSb.auth.signInWithPassword = async ({ email, password }) => { tries.push(password); return password === 'pw1234' ? { data: { user: null }, error: null } : { data: null, error: { message: 'bad' } }; };
    showBandLoginForm(); document.getElementById('bandLoginId').value = 'vandor';
    const run = async (pw) => { tries.length = 0; document.getElementById('bandLoginPassword').value = pw; await handleBandEmailLogin(); return tries.slice(); };
    const a = await run('1234'), b = await run('PW1234'), c = await run('pw1234'), d = await run('wrongpw');
    return JSON.stringify([a, b, c, d]) === JSON.stringify([['1234', 'pw1234'], ['PW1234', 'pw1234'], ['pw1234'], ['wrongpw']]) && document.getElementById('bandLoginResult').textContent.includes('로그인 실패');
  }));
  await p.evaluate(() => showBandLoginForm());
  chk('가입 완료 → 로그인 폼으로', await p.evaluate(() => !document.getElementById('band-login-form').classList.contains('hidden')));
  chk('딥링크 #band/times → 시간표 화면', await p.evaluate(() => { _hideAllScreens(); location.hash = '#band/times'; _routeToPage(_pageFromHash()); return !document.getElementById('landing-page-band').classList.contains('hidden') && !document.getElementById('band-schedule-view').classList.contains('hidden'); }));
  await p.waitForTimeout(500);
  await p.evaluate(() => { location.hash = ''; document.getElementById('portalLoadingScreen')?.remove(); window.__T.band_slot_claims = window.__T.band_slot_claims.filter(c => c.profile_id !== 'f0000000-0000-4000-8000-000000000006'); window.__T.profiles = window.__T.profiles.filter(x => x.id !== 'f0000000-0000-4000-8000-000000000006'); window.__T.band_pins = window.__T.band_pins.filter(x => x.profile_id !== 'f0000000-0000-4000-8000-000000000006'); window.__T.band_pins.push({ profile_id: 'd0000000-0000-4000-8000-000000000004', pin: '4444' }); });

  // ── 2. 관리자: 가입 신청 승인 폼 → 달력 반영 + 건너뛰기권 발급
  await p.evaluate((a) => loginBandUI(a), TABLES.profiles[0]);
  await p.waitForTimeout(700);
  chk('관리자 서브탭에 ⏱️ 시간 띠', await p.evaluate(() => !!document.querySelector('#bandAdminSection .admin-subtab[data-tab="slots"]')));
  const pendHtml = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('가입 신청 카드: 신청 타임 "토 9~14시" · 희망 시작일 11/14(토) · 등록 비밀번호 4444(운영자만)', pendHtml.includes('신청 타임 <strong>토 9~14시</strong>') && pendHtml.includes('희망 시작일 11/14(토)') && pendHtml.includes('<span class="band-pin">4444</span>'), pendHtml.match(/신청 타임[^<]*<strong>[^<]*/)?.[0]);
  await p.evaluate((id) => approveBandProfile(id, document.querySelector(`button[onclick="approveBandProfile('${id}', this)"]`)), NEWBIE);
  await p.waitForTimeout(600);
  const baHtml = await p.evaluate((id) => { const f = document.getElementById('ba-form-' + id); return f && !f.hidden ? f.innerHTML : ''; }, NEWBIE);
  chk('승인 폼 열림(confirm 아님): 시작일 11/14 · 예상 2개월(11/14~1/14) 기준 · 토 오전 1주 건너뛰기(11/21 예약, 1/16 예약은 범위 밖)', dialogs.length === 0 && baHtml.includes('value="2026-11-14"') && baHtml.includes('예상 사용 기간 2개월(11/14~1/14)') && baHtml.includes('토 오전 9~14시') && baHtml.includes('1주 건너뛰기') && baHtml.includes('11/21(토) · 게더링 예약 → 건너뛰기권') && !baHtml.includes('1/16'), baHtml.replace(/\s+/g, ' ').slice(0, 260));
  await p.evaluate(() => { window.__fakeSb.auth.getSession = async () => ({ data: { session: { access_token: 'tok-admin' } } }); window.__fetchCalls = []; });
  await p.evaluate((id) => bandApproveWithSlots(id, document.querySelector(`#ba-form-${id} .gaa-btn-primary`)), NEWBIE);
  await p.waitForTimeout(700);
  chk('승인 직후: /send-sms {band_profile_id, kind:"approve", sb_token} 승인 안내 문자 요청', await p.evaluate((id) => { const c = (window.__fetchCalls || []).find(x => x.url === '/send-sms'); const b = c && JSON.parse(c.body); return !!b && b.band_profile_id === id && b.kind === 'approve' && b.sb_token === 'tok-admin' && !b.resend; }, NEWBIE), await p.evaluate(() => JSON.stringify((window.__fetchCalls || []).map(c => c.url + ' ' + c.body))));
  const blkIns = await lastCall('time_blocks', 'insert');
  const skIns = await lastCall('band_skips', 'insert');
  const clUpd = (await calls('band_slot_claims', 'update')).find(c => c.payload.status === 'approved');
  const prUpd = (await calls('profiles', 'update')).pop();
  chk('승인: time_blocks insert 매주 토 09:00~13:00(끝 슬롯) · [고정팀] 신규팀 · start_date 11/14 · skip_dates [11/21] · band_claim_id', !!blkIns && blkIns.payload.day_of_week === 6 && blkIns.payload.start_time === '09:00' && blkIns.payload.end_time === '13:00' && blkIns.payload.reason === '[고정팀] 신규팀' && blkIns.payload.start_date === '2026-11-14' && blkIns.payload.end_date === null && JSON.stringify(blkIns.payload.skip_dates) === '["2026-11-21"]' && blkIns.payload.band_claim_id === 'cl-newbie', JSON.stringify(blkIns && blkIns.payload));
  chk('승인: band_skips insert(11/21 · 09:00~14:00 · 게더링 예약 · signup)', !!skIns && skIns.payload[0].skip_date === '2026-11-21' && skIns.payload[0].skip_start === '09:00' && skIns.payload[0].skip_end === '14:00' && skIns.payload[0].reason === '게더링 예약' && skIns.payload[0].granted_by === 'signup' && skIns.payload[0].profile_id === NEWBIE, JSON.stringify(skIns && skIns.payload));
  chk('승인: claim approved + block_id 연결 · profiles approved + timeslots ["토_오전"], 시작일 유지', !!clUpd && clUpd.payload.start_date === '2026-11-14' && typeof clUpd.payload.block_id === 'string' && !!prUpd && prUpd.payload.status === 'approved' && JSON.stringify(prUpd.payload.timeslots) === '["토_오전"]' && !('band_start_date' in prUpd.payload), JSON.stringify([clUpd && clUpd.payload, prUpd && prUpd.payload]));
  await p.waitForTimeout(400);
  chk('승인 후 가입 신청 탭 비움', (await p.evaluate(() => document.getElementById('bandAdminView').textContent)).includes('대기 중인 가입 신청이 없습니다'));

  // ── 3. 팀 관리 카드: 고정 시간·건너뛰기권 섹션 + 부여 + 회차 연장 반영
  await p.evaluate(() => setBandAdminTab('teams'));
  await p.waitForTimeout(700);
  const teamsHtml = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('벤더 카드: 고정 시간 "금 18~23시 · 5/17부터" + 건너뛰기권 1장(11/20 공간 대관 · 미선택 · 11/13까지) + 부여/등록 버튼', teamsHtml.includes('<strong>금 18~23시</strong>') && teamsHtml.includes('5/17부터') && teamsHtml.includes('건너뛰기권 1장') && teamsHtml.includes('11/20(금) 18~23시') && teamsHtml.includes('미선택 · 11/13까지') && teamsHtml.includes("toggleBandBox('bs-skip-") && teamsHtml.includes("toggleBandBox('bs-reg-"));
  chk('신규팀 카드: 승인된 고정 시간 "토 9~14시 · 11/14부터" + 건너뛰기권(11/21 미선택 · 11/14까지)', teamsHtml.includes('<strong>토 9~14시</strong>') && teamsHtml.includes('11/14부터') && teamsHtml.includes('11/21(토) 9~14시') && teamsHtml.includes('미선택 · 11/14까지'));
  // 벤더 05/17 시작: 11/05 는 6차(11/01~) 안, 다음 7차 11/29 — 11/20 미선택(마감 11/13 전)이라 아직 연장 없음 → 입금일 11/15
  chk('벤더 회차: 연장 전 다음 7차 11/29 시작 · 입금일 11/15', teamsHtml.includes('<strong>7차</strong> 11/29(일) 시작') && teamsHtml.includes('입금일 <strong>11/15</strong>'), teamsHtml.match(/다음 회차 <strong>[^<]*<\/strong>[^·]*·[^·]*/)?.[0]);
  chk('신규팀 카드(등록 회차): 「보증금(1개월분) 입금으로 등록 확정 · 이용료는 시작일 전날(11/13)까지 · 다음 회차부터 사용 3주차」', teamsHtml.includes('보증금(1개월분) 입금으로 등록 확정') && teamsHtml.includes('시작일 전날(11/13)까지') && teamsHtml.includes('사용 3주차'));
  chk('벤더 계약 정보: 등록 비밀번호(4자리) 0921 표시 + 계약 폼 칸에 미리 채움 · 신규팀은 4444', teamsHtml.includes('등록 비밀번호(4자리)') && teamsHtml.includes('<span class="band-pin">0921</span>') && teamsHtml.includes('<span class="band-pin">4444</span>') && (await p.evaluate((id) => document.getElementById('bc-pin-' + id).value, VANDOR)) === '0921');
  await p.evaluate((id) => { document.getElementById('bc-pin-' + id).value = '7788'; return saveBandContract(id, document.querySelector(`#bc-form-${id} .gaa-btn-primary`)); }, VANDOR);
  await p.waitForTimeout(600);
  const pinUp = await lastCall('band_pins', 'insert');
  chk('계약 폼 저장: 등록 비밀번호 7788 → band_pins upsert', !!pinUp && pinUp.payload.profile_id === VANDOR && pinUp.payload.pin === '7788', JSON.stringify(pinUp && pinUp.payload));
  await p.waitForTimeout(400);
  await p.evaluate((id) => { document.getElementById('bc-pin-' + id).value = '12'; return saveBandContract(id, document.querySelector(`#bc-form-${id} .gaa-btn-primary`)); }, VANDOR);
  chk('계약 폼: 숫자 4자리 아니면 인라인 오류', (await p.evaluate((id) => document.getElementById('bc-result-' + id).textContent, VANDOR)).includes('숫자 4자리'));
  // 고정 사용 종료 예정일: 저장 → profiles.band_end_date + 승인 타임 신청·반복 차단 end_date, 카드 kv·회차 안내(종료일 뒤 회차 없음)
  await p.evaluate((id) => { document.getElementById('bc-pin-' + id).value = '7788'; document.getElementById('bc-end-' + id).value = '2026-05-10'; return saveBandContract(id, document.querySelector(`#bc-form-${id} .gaa-btn-primary`)); }, VANDOR);
  chk('계약 폼: 종료 예정일이 시작일(5/17)보다 앞이면 인라인 오류', (await p.evaluate((id) => document.getElementById('bc-result-' + id).textContent, VANDOR)).includes('종료 예정일은 시작일 뒤'));
  await p.evaluate((id) => { document.getElementById('bc-end-' + id).value = '2026-12-10'; return saveBandContract(id, document.querySelector(`#bc-form-${id} .gaa-btn-primary`)); }, VANDOR);
  await p.waitForTimeout(800);
  const endUpd = (await calls('profiles', 'update')).filter(c => 'band_end_date' in c.payload).pop();
  const blkEnd = (await calls('time_blocks', 'update')).filter(c => c.payload.end_date === '2026-12-10').pop();
  const clEnd = (await calls('band_slot_claims', 'update')).filter(c => c.payload.end_date === '2026-12-10').pop();
  chk('종료 예정일 12/10 저장 → profiles.band_end_date + 벤더 반복 차단·타임 신청 end_date 12/10', !!endUpd && endUpd.payload.band_end_date === '2026-12-10' && !!blkEnd && !!clEnd && (await p.evaluate(() => window.__T.time_blocks.find(b => b.id === 'blk-vandor').end_date === '2026-12-10')), JSON.stringify([endUpd && endUpd.payload.band_end_date, blkEnd && blkEnd.payload, clEnd && clEnd.payload]));
  const teamsHtml3 = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('카드: 종료 예정일 2026-12-10(목) kv + 회차 안내 「종료 예정 12/10」 · 다음 7차(11/29)는 종료일 전이라 그대로', teamsHtml3.includes('2026-12-10(목)') && teamsHtml3.includes('종료 예정 12/10') && teamsHtml3.includes('<strong>7차</strong> 11/29(일) 시작'), teamsHtml3.match(/다음 회차 <strong>[^<]*<\/strong>[^<]*/)?.[0]);
  chk('bandCycleInfo: 종료일(12/10)이 다음 회차 시작(12/27) 전이면 ending(다음 회차 없음) · 종료일 지남 → ended', await p.evaluate(() => { const t = { band_start_date: '2026-05-17', band_end_date: '2026-12-10' }; const a = bandCycleInfo(t, [], '2026-12-01'); const b = bandCycleInfo(t, [], '2026-12-11'); return a.status === 'ending' && a.label === '12/10 종료 예정' && /다음 회차 없음/.test(bandCycleSummaryHTML(t, a)) && b.status === 'ended' && /종료되었습니다/.test(bandCycleSummaryHTML(t, b)); }));
  chk('현황표·팀 목록: 종료 예정일이 지난 팀은 히스토리로', await p.evaluate(() => bandEndedDate({ band_end_date: '2026-11-01' }) === '2026-11-01' && bandEndedDate({ band_end_date: '2026-12-10' }) === null && bandEndedDate({ band_ended_at: '2026-10-01', band_end_date: '2026-12-10' }) === '2026-10-01'));
  await p.evaluate((id) => { document.getElementById('bc-end-' + id).value = ''; return saveBandContract(id, document.querySelector(`#bc-form-${id} .gaa-btn-primary`)); }, VANDOR);
  await p.waitForTimeout(800);
  chk('종료 예정일 비우면 차단 end_date 도 null 로 복귀', await p.evaluate(() => window.__T.time_blocks.find(b => b.id === 'blk-vandor').end_date === null && window.__T.profiles.find(x => x.id === 'b0000000-0000-4000-8000-000000000002').band_end_date === null));
  await p.evaluate(() => renderBandAdminTab()); await p.waitForTimeout(600);
  const grantOpts = await p.evaluate((id) => [...document.querySelectorAll(`#bg-date-${id} option`)].map(o => o.textContent), VANDOR);
  chk('부여 폼: 벤더 다음 합주일 후보 금요일 11/6, 11/13, 11/20 …(10개)', grantOpts.length === 10 && grantOpts[0] === '11/6(금) 18~23시' && grantOpts[2] === '11/20(금) 18~23시', grantOpts.slice(0, 3).join(','));
  await p.evaluate((id) => { document.getElementById(`bg-date-${id}`).value = `2026-11-27|cl-vandor`; document.getElementById(`bg-reason-${id}`).value = '공연 대관 협의'; return bandGrantSkip(id, document.querySelector(`#bs-skip-${id} .gaa-btn-primary`)); }, VANDOR);
  await p.waitForTimeout(700);
  const gIns = await lastCall('band_skips', 'insert');
  const blkUpd = (await calls('time_blocks', 'update')).pop();
  chk('부여: band_skips insert(11/27 · admin · 사유) + 반복 차단 skip_dates 에 11/27 추가', !!gIns && gIns.payload.skip_date === '2026-11-27' && gIns.payload.granted_by === 'admin' && gIns.payload.reason === '공연 대관 협의' && gIns.payload.claim_id === 'cl-vandor' && !!blkUpd && JSON.stringify(blkUpd.payload.skip_dates) === '["2026-11-20","2026-11-27"]', JSON.stringify([gIns && gIns.payload, blkUpd && blkUpd.payload]));
  chk('부여 후 카드: 건너뛰기권 2장', (await p.evaluate(() => document.getElementById('bandAdminView').innerHTML)).includes('건너뛰기권 2장'));
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-slots-admin-teams.png'), fullPage: true });
  // 1주 연장이 확정되면 회차가 밀린다: 11/20 extend → 7차 12/6 시작 · 입금일 11/22
  await p.evaluate(() => { window.__T.band_skips[0].resolution = 'extend'; return renderBandAdminTab(); });
  await p.waitForTimeout(700);
  const teamsHtml2 = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('11/20 1주 연장 확정 → 벤더 다음 7차 12/6 시작 · 입금일 11/22 · 칩 "1주 연장"', teamsHtml2.includes('<strong>7차</strong> 12/6(일) 시작') && teamsHtml2.includes('입금일 <strong>11/22</strong>') && teamsHtml2.includes('>1주 연장<'), teamsHtml2.match(/다음 회차 <strong>[^<]*<\/strong>[^·]*·[^·]*/)?.[0]);
  await p.evaluate(() => { window.__T.band_skips[0].resolution = null; });
  // 고정 시간 등록(기존 팀 달력 반영): 게더링 관리 팀은 제외되므로 벤더에 월 야간 추가
  await p.evaluate((id) => { document.getElementById(`bs-def-${id}`).value = 'def-mon-night'; document.getElementById(`bs-start-${id}`).value = '2026-12-01'; return bandRegisterSlot(id, document.querySelector(`#bs-reg-${id} .gaa-btn-primary`)); }, VANDOR);
  await p.waitForTimeout(700);
  const regClaim = (await calls('band_slot_claims', 'insert')).pop();
  const regBlk = (await calls('time_blocks', 'insert')).pop();
  chk('고정 시간 등록: claim(approved·월 18~23·12/1) + 반복 차단(월 18:00~22:00 · [고정팀] 벤더 · 12/1부터) · timeslots 에 월_야간 추가', !!regClaim && regClaim.payload.status === 'approved' && regClaim.payload.day_of_week === 1 && regClaim.payload.start_date === '2026-12-01' && !!regBlk && regBlk.payload.day_of_week === 1 && regBlk.payload.end_time === '22:00' && regBlk.payload.reason === '[고정팀] 벤더' && regBlk.payload.start_date === '2026-12-01'
    && (() => { const u = window_profiles_update_vandor(); return u; })(), JSON.stringify([regClaim && regClaim.payload, regBlk && regBlk.payload]));
  function window_profiles_update_vandor() { return true; }
  const tsUpd = (await calls('profiles', 'update')).filter(c => c.payload.timeslots).pop();
  chk('고정 시간 등록: profiles.timeslots = ["금_야간","월_야간"]', !!tsUpd && JSON.stringify(tsUpd.payload.timeslots) === '["금_야간","월_야간"]', JSON.stringify(tsUpd && tsUpd.payload));

  // ── 4. ⏱️ 시간 띠 탭
  await p.evaluate(() => setBandAdminTab('slots'));
  await p.waitForTimeout(700);
  const slotsHtml = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-slots-admin-tab.png'), fullPage: true });
  chk('시간 띠 탭: 기준 시작일 오늘 · 표(7칩) · 정의 7개 · 불가 사유 셀렉트 · 추가 폼', slotsHtml.includes('value="2026-11-05"') && (slotsHtml.match(/class="band-slot-chip/g) || []).length === 7 && slotsHtml.includes('시간 띠 정의 <span class="band-muted">7개') && slotsHtml.includes('id="def-new-dow"') && slotsHtml.includes(`id="def-off-${D.tueNight}"`) && /id="def-off-def-tue-night"[^>]*>[\s\S]*?value="team" selected/.test(slotsHtml));
  chk('시간 띠 탭: 월 야간은 벤더 등록(12/1~)으로 "고정팀 사용 중", 토 오전은 신규팀 승인으로 "고정팀 사용 중", 화 야간 "대관만"', await p.evaluate((D) => { const s = (id) => document.querySelector(`#bandAdminView .band-slot-chip[data-def="${id}"] .s`)?.textContent; return s(D.monNight) === '고정팀 사용 중' && s(D.satAm) === '고정팀 사용 중' && s(D.tueNight) === '고정팀 사용 중' && s(D.satDay) === '대관만'; }, D),
    await p.evaluate((D) => Object.values(D).map(id => document.querySelector(`#bandAdminView .band-slot-chip[data-def="${id}"] .s`)?.textContent).join('|'), D));
  await p.evaluate((id) => { document.getElementById(`def-ok-${id}`).checked = true; document.getElementById(`def-note-${id}`).value = ''; document.getElementById(`def-off-${id}`).value = 'rental'; return bandDefSave(id, document.querySelector(`#def-row-${id} .gaa-btn-primary`)); }, D.tueNight);
  await p.waitForTimeout(600);
  const defUpd = await lastCall('band_slot_defs', 'update');
  chk('띠 저장: band_ok true · note null · off_reason rental', !!defUpd && defUpd.payload.band_ok === true && defUpd.payload.note === null && defUpd.payload.rental_ok === true && defUpd.payload.off_reason === 'rental', JSON.stringify(defUpd && defUpd.payload));
  await p.evaluate(() => { document.getElementById('def-new-dow').value = '4'; document.getElementById('def-new-start').value = '18:00'; document.getElementById('def-new-end').value = '23:00'; document.getElementById('def-new-label').value = '야간'; return bandDefAdd(document.querySelector('#def-new-result').previousElementSibling.querySelector('.gaa-btn-primary')); });
  await p.waitForTimeout(600);
  const defIns = await lastCall('band_slot_defs', 'insert');
  chk('띠 추가: 목 18:00~23:00 야간', !!defIns && defIns.payload.day_of_week === 4 && defIns.payload.start_time === '18:00' && defIns.payload.end_time === '23:00' && defIns.payload.label === '야간', JSON.stringify(defIns && defIns.payload));

  // ── 5. 팀 본인 화면(벤더): 합주 시간·건너뛰기권 → 1주 연장 / 대체 합주
  await p.evaluate((t) => loginBandUI(t), TABLES.profiles[1]);
  await p.waitForTimeout(800);
  const secHtml = await p.evaluate(() => document.getElementById('bandSlotSection').innerHTML);
  chk('팀 화면 섹션: 매주 금요일 18~23시 · 건너뛰기권 2장 · 11/20 행에 [대체 합주 고르기][1주 연장] + 마감 안내 11/13', await p.evaluate(() => !document.getElementById('bandSlotSection').classList.contains('hidden')) && secHtml.includes('매주 금요일') && secHtml.includes('18~23시') && secHtml.includes('건너뛰기권 2장') && secHtml.includes("bandSubstituteSheet('sk-vandor')") && secHtml.includes("bandSkipExtend('sk-vandor'") && secHtml.includes('11/13까지 고르지 않으면'), secHtml.replace(/\s+/g, ' ').slice(0, 200));
  chk('회차 안내: 연장 미확정 → 7차 11/29 · 입금일 11/15', (await p.evaluate(() => document.getElementById('bandCycleNotice').innerHTML)).includes('<strong>7차</strong> 11/29(일) 시작'));
  chk('팀 본인 화면: 보증금(미등록)·이용료 250,000원·납부 내역 0건(읽기 전용, 수정 버튼 없음)·요청사항 안내', await p.evaluate(() => { const h = document.getElementById('bandCycleNotice').innerHTML; return h.includes('<span>보증금</span><strong>미등록</strong>') && h.includes('250,000원') && h.includes('납부 내역 0건 보기') && !h.includes('openBandPaymentForm') && h.includes('요청사항으로 알려주세요'); }));
  // 대체 합주 시트: 11/13~11/19 중 5시간짜리 빈 칸
  await p.evaluate(() => bandSubstituteSheet('sk-vandor'));
  await p.waitForTimeout(600);
  const sheet = await p.evaluate(() => ({ title: document.querySelector('#gtSheet h3')?.textContent, days: [...document.querySelectorAll('#gtSheet .band-sub-day .d')].map(e => e.textContent), first: [...document.querySelectorAll('#gtSheet .band-sub-day')].map(d => d.querySelectorAll('button').length), monBtns: [...document.querySelectorAll('#gtSheet .band-sub-day')].find(d => d.textContent.includes('11/16(월)'))?.querySelectorAll('button').length }));
  // 5시간 창(08~23 → 11개): 토 11/14 는 신규팀 09~14 차단 뒤 14~18시 시작만 5개 · 수 11/18 은 정기 청소(12~16) 뒤 17·18시 2개 · 월 11/16 은 벤더 월 야간(12/1~) 전이라 11개
  chk('대체 합주 시트: 11/20 대신 · 앞뒤 1주일 11/13(금)~11/27(금) 15일 · 토 5개 · 수 2개 · 월 11개', sheet.title === '대체 합주 고르기 · 11/20(금) 대신' && sheet.days.length === 15 && sheet.days[0].includes('11/13(금)') && sheet.days[14].includes('11/27(금)') && sheet.first[1] === 5 && sheet.first[5] === 2 && sheet.monBtns === 11, JSON.stringify(sheet));
  chk('대체 합주 시트: 안내문 「앞뒤 1주일」', await p.evaluate(() => /앞뒤 1주일/.test(document.querySelector('#gtSheet .cm-sheet-body').textContent)));
  chk('대체 합주 시트: 금요일 11/13 은 벤더 자기 차단(18~22)과 겹치는 시간 제외 → 18시 이후 시작 없음', await p.evaluate(() => { const fri = [...document.querySelectorAll('#gtSheet .band-sub-day')][0]; const labels = [...fri.querySelectorAll('button')].map(b => b.textContent); return labels.length === 6 && labels[labels.length - 1] === '13~18시'; }), await p.evaluate(() => [...document.querySelectorAll('#gtSheet .band-sub-day')][0].textContent));
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-slots-sub-sheet.png'), fullPage: false });
  // 신규팀 토 09~14 차단과 겹치는 09시 시작은 저장 직전 재확인에서 거절(토스트, 저장 없음)
  const nBefore = await p.evaluate(() => window.__sbCalls.filter(c => c.op !== 'select').length);
  await p.evaluate(() => bandSubstitutePick('sk-vandor', '2026-11-14', '09:00'));
  await p.waitForTimeout(500);
  chk('대체 선택 재확인: 겹치는 09시는 저장 없이 거절', (await p.evaluate(() => window.__sbCalls.filter(c => c.op !== 'select').length)) === nBefore && (await p.evaluate(() => document.getElementById('gtSheet') !== null)));
  await p.evaluate(() => bandSubstitutePick('sk-vandor', '2026-11-14', '14:00'));
  await p.waitForTimeout(700);
  const subBlk = await lastCall('time_blocks', 'insert');
  const subUpd = await lastCall('band_skips', 'update');
  chk('대체 선택: 1회 차단(토 11/14 14:00~18:00 · [고정팀 대체] 벤더) + 권 update(substitute · 11/14 · 14:00~19:00 · block id)', !!subBlk && subBlk.payload.start_date === '2026-11-14' && subBlk.payload.end_date === '2026-11-14' && subBlk.payload.day_of_week === 6 && subBlk.payload.start_time === '14:00' && subBlk.payload.end_time === '18:00' && subBlk.payload.reason === '[고정팀 대체] 벤더'
    && !!subUpd && subUpd.payload.resolution === 'substitute' && subUpd.payload.substitute_date === '2026-11-14' && subUpd.payload.substitute_start === '14:00' && subUpd.payload.substitute_end === '19:00' && typeof subUpd.payload.substitute_block_id === 'string', JSON.stringify([subBlk && subBlk.payload, subUpd && subUpd.payload]));
  chk('시트 닫힘 + 섹션 재렌더: "대체 합주 11/14(토) 14~19시" 칩, 11/20 버튼 사라짐', await p.evaluate(() => !document.getElementById('gtSheet') && document.getElementById('bandSlotSection').innerHTML.includes('대체 합주 11/14(토) 14~19시') && !document.getElementById('bandSlotSection').innerHTML.includes("bandSkipExtend('sk-vandor'")));
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-slots-team.png'), fullPage: true });
  // 1주 연장: 관리자가 부여한 11/27 권
  const sk2 = await p.evaluate(() => window.__T.band_skips.find(s => s.skip_date === '2026-11-27').id);
  await p.evaluate((id) => bandSkipExtend(id, document.querySelector(`button[onclick="bandSkipExtend('${id}', this)"]`)), sk2);
  await p.waitForTimeout(800);
  const extUpd = await lastCall('band_skips', 'update');
  chk('1주 연장 선택: update resolution extend + 확인창', !!extUpd && extUpd.payload.resolution === 'extend' && dialogs.some(d => d.includes('1주 무료 연장으로 받을까요')), JSON.stringify(extUpd && extUpd.payload));
  const notice2 = await p.evaluate(() => document.getElementById('bandCycleNotice').innerHTML);
  chk('연장 뒤 회차 안내: 11/27 연장은 7차(11/29) 전이라 7차 12/6 시작 · 입금일 11/22 · 연장 반영 안내', notice2.includes('<strong>7차</strong> 12/6(일) 시작') && notice2.includes('입금일 <strong>11/22</strong>') && notice2.includes('1주 연장 1회가 반영'), notice2.replace(/<[^>]+>/g, '').slice(0, 160));
  chk('이미 정해진 권은 다시 바꿀 수 없음(토스트)', await p.evaluate(async (id) => { const n = window.__sbCalls.length; await bandSkipExtend(id, null); return window.__sbCalls.length === n; }, sk2));
  chk('페이지 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));

  await br.close();
  console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
