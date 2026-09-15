// 고정 합주팀 UI 스모크: 게더링(관리자) 로그인 → 팀 관리(계약 정보·회차·입금 폼) → 현황표(카드/표/CSV) → 팀 본인 화면 회차 안내
// + 라이트/다크 스크린샷(스크래치패드) + 합주팀 구역 인라인 버튼 회귀 카운트
// 실행: (repo 루트 서빙) python3 -m http.server 8766 & NODE_PATH=<scratchpad>/node_modules node tests/ui-band.js
const { chromium } = require('playwright');
const path = require('path');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const SHOT_DIR = process.env.SHOT_DIR || path.join(process.cwd(), 'ui-shots');
const PORT = process.env.PORT || 8766;

const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';
const VANDOR = 'b0000000-0000-4000-8000-000000000002';
const ANAHA = 'c0000000-0000-4000-8000-000000000003';
const NEWBIE = 'd0000000-0000-4000-8000-000000000004';
const PURPLE = 'e0000000-0000-4000-8000-000000000005';
const TABLES = {
  profiles: [
    { id: ADMIN_ID, member_type: 'band', status: 'approved', band_name_kr: '게더링', band_name_en: 'GatheO', leader_name: '최경수', leader_phone: '010-5109-1042', instruments: 'wearegatheo', email: 'wearegatheo@band.gatheo.kr', timeslots: ['금_야간'], created_at: '2026-01-01T00:00:00Z' },
    { id: VANDOR, member_type: 'band', status: 'approved', band_name_kr: '벤더', band_name_en: 'Vandor', leader_name: '권율', leader_phone: '010-7484-0121', instruments: 'vandor', email: 'vandor@band.gatheo.kr', timeslots: ['일_야간'],
      band_start_date: '2026-05-17', band_expected_months: '6개월 이상', band_deposit: 250000, band_deposit_paid_at: '2026-05-07', band_fee: 250000, created_at: '2026-05-01T00:00:00Z' },
    { id: ANAHA, member_type: 'band', status: 'approved', band_name_kr: '아나하', band_name_en: '', leader_name: '신선진', leader_phone: '010-6787-1995', instruments: 'anaha', email: 'anaha@band.gatheo.kr', timeslots: ['화_야간', '수_야간'],
      band_start_date: '2026-09-15', band_expected_months: '-개월 이상', band_deposit: 200000, band_deposit_paid_at: '2026-09-05', band_fee: 300000, created_at: '2026-09-01T00:00:00Z' },
    { id: NEWBIE, member_type: 'band', status: 'pending', band_name_kr: '신규팀', band_name_en: 'Newbie', leader_name: '김신규', leader_phone: '010-1111-2222', instruments: 'newbie', email: 'newbie@band.gatheo.kr', timeslots: ['수_주간'], created_at: '2026-09-10T00:00:00Z' },
    { id: PURPLE, member_type: 'band', status: 'rejected', band_name_kr: '코드 퍼플', band_name_en: 'Code Purple', leader_name: '고범찬', leader_phone: 'beomchan_koh (인스타)', instruments: 'purple', email: 'purple@band.gatheo.kr', timeslots: ['일_주간'],
      band_start_date: '2026-04-12', band_expected_months: '12개월', band_deposit: null, band_ended_at: '2026-08-09', created_at: '2026-04-01T00:00:00Z' },
  ],
  band_payments: [
    { id: 'p1', team_id: VANDOR, paid_at: '2026-05-17', cycle_no: null, amount: 250000, note: '' },
    { id: 'p2', team_id: VANDOR, paid_at: '2026-06-08', cycle_no: null, amount: 250000, note: '' },
    { id: 'p3', team_id: VANDOR, paid_at: '2026-07-07', cycle_no: 2, amount: 250000, note: '' },
    { id: 'p4', team_id: VANDOR, paid_at: '2026-08-07', cycle_no: 3, amount: 250000, note: '' },
    { id: 'p5', team_id: VANDOR, paid_at: '2026-08-30', cycle_no: 4, amount: 250000, note: '카톡 확인' },
    { id: 'p6', team_id: PURPLE, paid_at: '2026-04-12', cycle_no: 0, amount: 250000, note: '' },
    { id: 'p7', team_id: PURPLE, paid_at: '2026-05-10', cycle_no: 1, amount: 250000, note: '' },
  ],
  band_rent_reminders: [{ team_id: VANDOR, cycle_no: 4, kind: 'due', sent_at: '2026-08-30T23:00:00Z' }],
  band_notices: [{ id: 'n1', title: '9월 공지', content: '냉방기 리모컨은 선반 위', created_by: '게더링', created_at: '2026-09-01T00:00:00Z' }],
  band_members: [{ id: 'm1', band_profile_id: VANDOR, name: '권율', part: '보컬', created_at: '2026-05-01T00:00:00Z' }],
  band_comments: [{ id: 'c1', band_profile_id: VANDOR, author_name: '벤더(Vandor)', content: '다음주 합주 있어요', parent_id: null, created_at: '2026-09-10T00:00:00Z' }],
};

// 브라우저 안에 심을 가짜 supabase 클라이언트 — eq/in/order/limit/insert/update/delete 를 흉내내고 호출을 기록
const FAKE_SB = `
(function () {
  const T = ${JSON.stringify(TABLES)};
  window.__sbCalls = [];
  function builder(table) {
    const st = { table, op: 'select', filters: [], payload: null, single: false };
    const b = {};
    const chain = (k, f) => { b[k] = (...a) => { f(...a); return b; }; };
    chain('select', () => {});
    chain('insert', (row) => { st.op = 'insert'; st.payload = row; });
    chain('update', (row) => { st.op = 'update'; st.payload = row; });
    chain('delete', () => { st.op = 'delete'; });
    chain('upsert', (row) => { st.op = 'insert'; st.payload = row; });
    chain('eq', (c, v) => st.filters.push(r => r[c] === v));
    chain('neq', (c, v) => st.filters.push(r => r[c] !== v));
    chain('in', (c, vs) => st.filters.push(r => vs.includes(r[c])));
    chain('is', (c, v) => st.filters.push(r => r[c] == v));
    chain('not', () => {});
    chain('lt', () => {}); chain('gte', () => {}); chain('lte', () => {}); chain('gt', () => {});
    chain('order', () => {}); chain('limit', () => {}); chain('range', () => {});
    chain('maybeSingle', () => { st.single = true; });
    chain('single', () => { st.single = true; });
    b.then = (res, rej) => {
      const rows = (T[table] || []);
      const hit = rows.filter(r => st.filters.every(f => f(r)));
      window.__sbCalls.push({ table, op: st.op, payload: st.payload, n: hit.length });
      let data = null, error = null;
      if (st.op === 'select') data = st.single ? (hit[0] || null) : hit;
      else if (st.op === 'insert') { const row = Object.assign({ id: 'new-' + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString() }, st.payload); rows.push(row); data = [row]; }
      else if (st.op === 'update') { hit.forEach(r => Object.assign(r, st.payload)); data = hit; }
      else if (st.op === 'delete') { hit.forEach(r => rows.splice(rows.indexOf(r), 1)); data = hit; }
      return Promise.resolve({ data, error }).then(res, rej);
    };
    return b;
  }
  window.__fakeSb = {
    from: builder,
    auth: { signOut: async () => ({}), getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {},
  };
})();`;

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await br.newContext({ viewport: { width: 420, height: 950 }, deviceScaleFactor: 2, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-09-15T10:00:00+09:00'));
  await p.route('**://**', async r => {
    const u = new URL(r.request().url());
    return u.hostname === '127.0.0.1' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.addScriptTag({ content: FAKE_SB });
  await p.evaluate(() => {
    document.getElementById('portalLoadingScreen')?.remove();
    document.getElementById('bgm-player')?.remove();
    applyTheme('light');
    supabaseClient = window.__fakeSb;
    window.sendAdminPush = () => {}; // 푸시 스텁
  });

  // ── 1. 관리자 로그인 → 팀 관리 탭
  await p.evaluate((admin) => loginBandUI(admin), TABLES.profiles[0]);
  await p.waitForTimeout(600);
  chk('밴드 메인 표시 + 관리자 섹션 노출', await p.evaluate(() => !document.getElementById('band-main-content').classList.contains('hidden') && !document.getElementById('bandAdminSection').classList.contains('hidden')));
  await p.evaluate(() => setBandAdminTab('teams'));
  await p.waitForTimeout(600);
  const teamsHtml = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('팀 관리: 벤더 계약 정보(시작일·보증금·사용료)', teamsHtml.includes('2026-05-17(일)') && teamsHtml.includes('250,000원 · 5/7 입금') && teamsHtml.includes('6개월 이상'));
  chk('팀 관리: 벤더 회차 요약 — 이번 회차 4차, 다음 5차 10/4 시작, 입금일 9/27', teamsHtml.includes('이번 회차 <strong>4차</strong> 9/6 ~ 9/27') && teamsHtml.includes('<strong>5차</strong> 10/4(일) 시작') && teamsHtml.includes('입금일 <strong>9/27</strong>'), teamsHtml.match(/이번 회차[^<]*<strong>[^<]*<\/strong>[^<]*/)?.[0]);
  chk('팀 관리: 벤더 상태 칩 "입금일 12일 후"', teamsHtml.includes('입금일 12일 후'));
  chk('팀 관리: 벤더 문자 발송 이력(최근 4차 입금일 안내, KST 날짜)', teamsHtml.includes('최근 문자: 4차 입금일 안내 8/31 발송'), teamsHtml.match(/최근 문자[^<]*/)?.[0]);
  chk('팀 관리: 아나하 — 오늘 시작, 다음 1차 10/13, 입금일 10/6', teamsHtml.includes('<strong>1차</strong> 10/13(화) 시작') && teamsHtml.includes('입금일 <strong>10/6</strong>'));
  chk('팀 관리: 관리자 팀 카드엔 계약/입금 섹션 없음 + 본인 팀 칩', teamsHtml.includes('본인 팀') && (teamsHtml.match(/계약 정보/g) || []).length === 2);
  chk('팀 관리: 인라인 스타일 버튼 없음(gaa-btn만)', !/<button[^>]*style="[^"]*border-radius/.test(teamsHtml));
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-teams-light.png'), fullPage: true });

  // ── 2. 납부 내역 + 입금 폼(회차 기본값) + 저장
  await p.evaluate((id) => toggleBandPaymentHistory(id, document.querySelector(`#pay-hist-${id}`)?.previousElementSibling?.previousElementSibling?.lastElementChild), VANDOR);
  const hist = await p.evaluate((id) => document.getElementById('pay-hist-' + id).innerHTML, VANDOR);
  chk('납부 내역: 구형 행 회차 귀속(등록·1차) + 명시 회차(2~4차)', hist.includes('<strong>등록</strong> · 2026-05-17') && hist.includes('<strong>1차</strong> · 2026-06-08') && hist.includes('<strong>4차</strong> · 2026-08-30') && hist.includes('250,000원'));
  await p.evaluate((id) => openBandPaymentForm(id), VANDOR);
  const defCycle = await p.evaluate((id) => document.getElementById('bp-cycle-' + id).value, VANDOR);
  const defAmount = await p.evaluate((id) => document.getElementById('bp-amount-' + id).value, VANDOR);
  const defDate = await p.evaluate((id) => document.getElementById('bp-date-' + id).value, VANDOR);
  chk('입금 폼 기본값: 5차 · 사용료 250000 · 오늘', defCycle === '5' && defAmount === '250000' && defDate === '2026-09-15', `${defCycle}/${defAmount}/${defDate}`);
  await p.evaluate((id) => { document.getElementById('bp-date-' + id).value = ''; }, VANDOR);
  await p.evaluate((id) => saveBandPayment(id, document.querySelector(`#bp-form-${id} .gaa-btn-primary`)), VANDOR);
  chk('입금 폼: 납부일 비면 인라인 오류', await p.evaluate((id) => document.getElementById('bp-result-' + id).textContent, VANDOR) === '납부일을 선택해주세요.');
  await p.evaluate((id) => { document.getElementById('bp-date-' + id).value = '2026-09-26'; }, VANDOR);
  await p.evaluate((id) => saveBandPayment(id, document.querySelector(`#bp-form-${id} .gaa-btn-primary`)), VANDOR);
  await p.waitForTimeout(500);
  const ins = await p.evaluate(() => window.__sbCalls.filter(c => c.table === 'band_payments' && c.op === 'insert').pop());
  chk('입금 저장: band_payments insert(team·5차·금액)', !!ins && ins.payload.team_id === VANDOR && ins.payload.cycle_no === 5 && ins.payload.amount === 250000 && ins.payload.paid_at === '2026-09-26', JSON.stringify(ins && ins.payload));
  const after = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('저장 후 재렌더: 벤더 "5차 납부 완료" 칩', after.includes('5차 납부 완료'));

  // ── 3. 계약 정보 저장
  await p.evaluate((id) => toggleBandBox('bc-form-' + id), ANAHA);
  await p.evaluate((id) => { document.getElementById('bc-fee-' + id).value = '280000'; document.getElementById('bc-memo-' + id).value = '캐비넷 1'; }, ANAHA);
  await p.evaluate((id) => saveBandContract(id, document.querySelector(`#bc-form-${id} .gaa-btn-primary`)), ANAHA);
  await p.waitForTimeout(500);
  const upd = await p.evaluate(() => window.__sbCalls.filter(c => c.table === 'profiles' && c.op === 'update').pop());
  chk('계약 정보 저장: profiles update(band_fee·band_memo·시작일 유지)', !!upd && upd.payload.band_fee === 280000 && upd.payload.band_memo === '캐비넷 1' && upd.payload.band_start_date === '2026-09-15', JSON.stringify(upd && upd.payload));

  // ── 4. 현황표 — 카드 → 표 → CSV
  await p.evaluate(() => setBandAdminTab('roster'));
  await p.waitForTimeout(600);
  const cards = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('현황표(카드): 진행중 2팀·대기 1팀·히스토리 1팀, 관리자 팀 제외', cards.includes('진행중인 고정팀 <span class="band-muted">2팀') && cards.includes('대기팀 <span class="band-muted">1팀') && cards.includes('히스토리 <span class="band-muted">1팀') && !cards.includes('게더링'));
  chk('현황표(카드): 벤더 회차 스트립(등록 ✓ 5/17 … 5차 ✓ 9/26)', cards.includes('등록 ✓ 5/17') && cards.includes('1차 ✓ 6/8') && cards.includes('4차 ✓ 8/30') && cards.includes('5차 ✓ 9/26'));
  chk('현황표(카드): 아나하 1차 입금일 10/6 칩', cards.includes('1차 입금일 10/6'));
  chk('현황표: 히스토리 실사용 "2회 (26/04/12 ~ 26/08/09)"', cards.includes('2회 (26/04/12 ~ 26/08/09)'));
  chk('현황표: 대기팀 신규팀 표시', cards.includes('신규팀') && cards.includes('수 주간'));
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-roster-cards-light.png'), fullPage: true });
  await p.evaluate(() => setBandRosterView('table'));
  await p.waitForTimeout(500);
  const table = await p.evaluate(() => document.getElementById('bandAdminView').innerHTML);
  chk('현황표(표): 시트와 같은 3행(입금/시작일/종료일) × 회차 열', table.includes('>입금<') && table.includes('>시작일<') && table.includes('>종료일<') && table.includes('12차 추가'));
  chk('현황표(표): 벤더 시작일 열 26/06/14·종료일 26/06/07·등록 입금 26/05/17 (26/05/07)', table.includes('>26/06/14<') && table.includes('>26/06/07<') && table.includes('26/05/17 (26/05/07)'));
  chk('현황표(표): 아나하 1차 입금 셀 "입금일 26/10/06"', table.includes('입금일 26/10/06'));
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-roster-table-light.png'), fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => downloadBandRosterCsv())]);
  const csvPath = await dl.path();
  const csv = require('fs').readFileSync(csvPath, 'utf8');
  chk('CSV: BOM + 3구역 + 벤더 3행', csv.charCodeAt(0) === 0xFEFF && csv.includes('▶ 진행중인 고정팀') && csv.includes('▶ 대기팀') && csv.includes('▶ 히스토리') && csv.includes('1,일 야간,벤더,권율,010-7484-0121,26/05/17,6개월 이상 (보증금 25만 완),입금,26/05/17 (26/05/07)'), csv.split('\n')[2]);
  chk('CSV: 벤더 종료일 행 26/06/07·26/07/05', csv.includes(',종료일,26/06/07,26/07/05,'));

  // ── 5. 탈퇴 처리 → band_ended_at 기록
  await p.evaluate(() => setBandAdminTab('teams'));
  await p.waitForTimeout(500);
  await p.evaluate((id) => removeBandProfile(id, null), ANAHA);
  await p.waitForTimeout(500);
  const rm = await p.evaluate(() => window.__sbCalls.filter(c => c.table === 'profiles' && c.op === 'update').pop());
  chk('탈퇴 처리: status rejected + band_ended_at 오늘', !!rm && rm.payload.status === 'rejected' && rm.payload.band_ended_at === '2026-09-15', JSON.stringify(rm && rm.payload));

  // ── 6. 다크 모드 스크린샷 + 팀 본인 화면(벤더) 회차 안내
  await p.evaluate(() => applyTheme('dark'));
  await p.evaluate(() => setBandAdminTab('roster'));
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-roster-table-dark.png'), fullPage: true });
  await p.evaluate(() => applyTheme('light'));
  await p.evaluate((t) => loginBandUI(t), TABLES.profiles[1]);
  await p.waitForTimeout(700);
  const notice = await p.evaluate(() => document.getElementById('bandCycleNotice').innerHTML);
  const adminHidden = await p.evaluate(() => document.getElementById('bandAdminSection').classList.contains('hidden'));
  chk('팀 본인 화면: 회차 안내(5차 납부 완료·다음 6차·계좌) + 관리자 섹션 숨김', adminHidden && notice.includes('5차 납부 완료') && notice.includes('토스뱅크 1000-2274-7678') && notice.includes('이번 회차'), notice.slice(0, 160));
  const infoHtml = await p.evaluate(() => document.getElementById('bandInfoCard').innerHTML);
  chk('밴드 정보: 합주 타임 시트 표기 "일 야간"', infoHtml.includes('일 야간'));
  await p.evaluate(() => toggleBandInfoEdit());
  await p.evaluate(() => { document.getElementById('bandEditNameKr').value = ''; saveBandInfo(document.querySelector('#bandInfoEditForm .gaa-btn-primary')); });
  chk('정보 수정: 빈 밴드명 → 인라인 오류(alert 없음)', await p.evaluate(() => document.getElementById('bandInfoResult').textContent) === '밴드명(국문)을 입력해주세요.');
  await p.screenshot({ path: path.join(SHOT_DIR, 'band-member-light.png'), fullPage: true });

  // ── 7. 합주팀 구역 인라인 버튼 회귀 카운트 (band-main-content 안)
  const inlineBtns = await p.evaluate(() => Array.from(document.querySelectorAll('#band-main-content button')).filter(b => /border-radius|background:/.test(b.getAttribute('style') || '')).map(b => b.outerHTML.slice(0, 80)));
  chk('합주팀 구역: 인라인 스타일 버튼 0개', inlineBtns.length === 0, inlineBtns.join(' | '));
  chk('페이지 오류 없음', errs.length === 0, errs.join(' | ').slice(0, 300));

  await br.close();
  console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
