// 커뮤니티 신청자 명단은 서버 경유(2026-11-10): 공개 화면에 이름·연락처가 내려오지 않는지, 신청·신청 조회·모임장 명단이 /community-admin app_* 로 가는지.
// 실행: (repo 루트 서빙) python3 -m http.server 8765 & NODE_PATH=<scratchpad>/node_modules node tests/ui-community-apps.js
const { chromium } = require('playwright');
let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };
const PORT = process.env.PORT || 8765;
const CM = 'c1111111-1111-4111-8111-111111111111';
const MEETING = { id: CM, title: '주말 합주 클래스', meeting_date: '2026-11-21', meeting_time: '14:00 ~ 17:00', location: '합주실', organizer_name: '김모임', organizer_phone: '010-1234-5678', organizer_email: 'a@b.kr', fee: '무료', capacity: 12, description: '설명', is_closed: false, status: 'active', created_at: '2026-11-01T00:00:00Z',
  form_fields: [{ label: '세션', type: 'select', required: true, options: ['기타', '드럼'], limits: { 드럼: 1 } }] };
const MEETING2 = { id: 'c2222222-2222-4222-8222-222222222222', title: '제목이 아주 길어서 두 줄로 넘어가는 초겨울 어쿠스틱 잼 세션 모임', meeting_date: '2026-11-28', meeting_time: '19:00 ~ 22:00', location: '', organizer_name: '이모임', fee: '10,000원', capacity: 0 };
const FULL = [{ id: 'a1111111-1111-4111-8111-111111111111', meeting_id: CM, applicant_name: '박비밀', applicant_phone: '010-7777-8888', status: 'pending', form_data: { 세션: '드럼' }, created_at: '2026-11-05T00:00:00Z' }];
const FAKE_SB = `(function(){ window.__sbCalls=[]; const T={community_meetings:[${JSON.stringify(MEETING)},${JSON.stringify(MEETING2)}]};
 function builder(table){ const st={op:'select'}; const b={}; ['select','eq','neq','in','is','not','lt','gte','lte','gt','order','limit','range','maybeSingle','single'].forEach(k=>{b[k]=()=>b;}); ['insert','update','delete','upsert'].forEach(k=>{b[k]=()=>{st.op=k;return b;};});
  b.then=(res,rej)=>{ window.__sbCalls.push(table+':'+st.op); return Promise.resolve({data: st.op==='select'?(T[table]||[]):null,error:null}).then(res,rej); }; return b; }
 window.__fakeSb={from:builder,rpc:async()=>({data:null,error:null}),functions:{invoke:async(fn,o)=>({data:{ok: fn==='verify-meeting-password' && o.body.password==='right'},error:null})},
  auth:{signOut:async()=>({}),getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}}; })();`;

(async () => {
  const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
  const p = await ctx.newPage(); await p.clock.setFixedTime(new Date('2026-11-09T10:00:00+09:00'));
  const api = []; let mode = 'ok';
  await p.route('**://**', async r => {
    const u = new URL(r.request().url());
    if (u.hostname !== '127.0.0.1' || u.pathname.startsWith('/vendor/supabase')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    if (u.pathname === '/send-email') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (u.pathname !== '/community-admin') return r.continue();
    if (mode === '501') return r.fulfill({ status: 501, body: 'no' });
    const b = JSON.parse(r.request().postData() || '{}'); api.push(b);
    const send = (status, obj) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (b.action === 'app_counts') return send(200, { ok: true, counts: { [CM]: 1 } });
    if (b.action === 'app_public') return send(200, { ok: true, rows: [{ status: 'pending', form_data: { 세션: '드럼' } }] });
    if (b.action === 'app_apply') return b.phone.replace(/\D/g, '') === '01077778888' ? send(409, { ok: false, error: 'dup', message: '이미 신청하셨습니다.' }) : send(200, { ok: true, id: 'new-app' });
    if (b.action === 'app_mine') return send(200, { ok: true, rows: b.phone === '01077778888' ? FULL : [] });
    if (b.action === 'app_cancel') return send(200, { ok: true, cancelled: true });
    if (b.action === 'app_auth') return b.pw === 'right' ? send(200, { ok: true, token: 'tok-1', exp: Date.now() + 7200e3 }) : send(403, { ok: false, message: '비밀번호가 틀렸습니다.' });
    if (b.action === 'app_list') return b.token === 'tok-1' ? send(200, { ok: true, rows: FULL }) : send(401, { ok: false, message: '모임장 인증이 만료되었습니다.' });
    if (b.action === 'app_status' || b.action === 'app_delete') return send(200, { ok: true, changed: 1 });
    return send(400, { ok: false });
  });
  const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await p.addScriptTag({ content: FAKE_SB });
  await p.evaluate(() => { document.getElementById('portalLoadingScreen')?.remove(); document.getElementById('bgm-player')?.remove(); supabaseClient = window.__fakeSb; window.open = () => null; showCommunitySection(); });
  await p.waitForTimeout(1200);
  const sb = () => p.evaluate(() => window.__sbCalls.filter(c => c.startsWith('community_applications')));

  // 1. 목록·상세: 인원 수와 요약만
  chk('목록: 신청 수는 app_counts', api.some(a => a.action === 'app_counts' && a.meeting_ids.includes(CM)) && (await sb()).length === 0);
  await p.waitForSelector('#communityContent .cm-ev', { timeout: 5000 }).catch(() => {});
  const th = await p.evaluate(() => [...document.querySelectorAll('#communityContent .cm-ev')].map(ev => { const r = ev.querySelector('.th').getBoundingClientRect(), b = ev.querySelector('.bd').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), bd: Math.round(b.height) }; }));
  chk('목록: 썸네일은 카드마다 같은 크기의 정방형(글 높이와 무관)', th.length === 2 && th.every(t => t.w === th[0].w && t.h === t.w && t.w >= 88) && th[0].bd !== th[1].bd, JSON.stringify(th));
  await p.evaluate((id) => renderCommunityDetail(id), CM); await p.waitForTimeout(900);
  chk('상세: app_public 만 호출(직접 조회 없음)', api.some(a => a.action === 'app_public') && !api.some(a => a.action === 'app_list') && (await sb()).length === 0);
  chk('상세: 브라우저 상태에 이름·연락처 없음', await p.evaluate(() => !JSON.stringify(state.communityCurrentAppList).includes('010') && !JSON.stringify(state.communityCurrentAppList).includes('박비밀')));
  await p.evaluate(() => cmApplySheetOpen()); await p.waitForTimeout(400);
  chk('신청 폼: 정원 찬 선택지(드럼)는 마감 표시', /드럼.*마감/.test(await p.evaluate(() => document.getElementById('communityApplyForm')?.textContent || document.getElementById('cmApplySheet')?.textContent || '')));

  // 2. 신청: 서버가 중복 확인·저장
  const fill = (name, phone) => p.evaluate(({ name, phone }) => { document.getElementById('ca_name').value = name; document.getElementById('ca_phone').value = phone; const sel = document.querySelector('#communityApplyForm select, #cmApplySheet select'); if (sel) { sel.value = '기타'; sel.dispatchEvent(new Event('change', { bubbles: true })); } else { const rd = [...document.querySelectorAll('#cmApplySheet input[type=radio]')].find(x => x.value === '기타'); if (rd) rd.click(); } }, { name, phone });
  await fill('박비밀', '010-7777-8888');
  await p.evaluate((id) => submitCommunityApplication(id), CM); await p.waitForTimeout(700);
  chk('같은 연락처 재신청은 안내', dialogs.some(d => /이미 신청/.test(d)) && api.some(a => a.action === 'app_apply'), dialogs.join('|'));
  await p.evaluate(() => { if (!document.getElementById('ca_name')) cmApplySheetOpen(); }); await p.waitForTimeout(300);
  await fill('새사람', '010-2222-3333');
  await p.evaluate((id) => submitCommunityApplication(id), CM); await p.waitForTimeout(900);
  const ap = api.filter(a => a.action === 'app_apply').pop();
  chk('신청 저장은 app_apply', ap && ap.name === '새사람' && ap.meeting_id === CM && ap.form_data && ap.form_data['세션'] === '기타' && (await sb()).length === 0, JSON.stringify(ap));

  // 3. 신청 조회·취소
  await p.evaluate(() => renderCommunityMyApps()); await p.waitForTimeout(400);
  await p.evaluate(() => { document.getElementById('myAppName').value = '박비밀'; document.getElementById('myAppPhone').value = '010-7777-8888'; });
  await p.evaluate(() => lookupCommunityMyApps()); await p.waitForTimeout(600);
  chk('신청 조회는 app_mine(이름+연락처)', api.some(a => a.action === 'app_mine' && a.name === '박비밀' && a.phone === '01077778888') && (await p.evaluate(() => document.getElementById('myAppList').textContent)).includes('주말 합주 클래스'));
  await p.evaluate((id) => cancelMyCommunityApplication('a1111111-1111-4111-8111-111111111111', id), CM); await p.waitForTimeout(600);
  chk('취소는 app_cancel(연락처 함께)', api.some(a => a.action === 'app_cancel' && a.phone === '01077778888'));

  // 4. 모임장: 비밀번호 → 토큰 → 전체 명단
  api.length = 0;
  const okWrong = await p.evaluate(async (id) => checkCommunityOrganizer(state.communityMeetings.find(m => m.id === id), 'nope'), CM);
  chk('틀린 비밀번호는 인증 실패·토큰 없음', okWrong === false && !(await p.evaluate((id) => state.communityOrgTok[id], CM)));
  const okRight = await p.evaluate(async (id) => { const ok = await checkCommunityOrganizer(state.communityMeetings.find(m => m.id === id), 'right'); if (ok) { state.communityEditAuth[id] = true; state.communityEditView = id; state.communityEditTab = 'applicants'; } return ok; }, CM);
  chk('맞는 비밀번호 → 모임장 토큰', okRight === true && (await p.evaluate((id) => state.communityOrgTok[id], CM)) === 'tok-1');
  await p.evaluate((id) => renderCommunityDetail(id), CM); await p.waitForTimeout(900);
  chk('모임장 화면은 app_list 로 전체 명단', api.some(a => a.action === 'app_list' && a.token === 'tok-1') && await p.evaluate(() => JSON.stringify(state.communityCurrentAppList).includes('박비밀')));
  await p.evaluate((id) => setCommunityApplicationStatus(id, 'a1111111-1111-4111-8111-111111111111', 'accepted'), CM); await p.waitForTimeout(700);
  chk('수락은 app_status(토큰)', api.some(a => a.action === 'app_status' && a.status === 'accepted' && a.token === 'tok-1') && (await sb()).length === 0);
  await p.evaluate((id) => { state.communityOrgTok[id] = 'expired'; return renderCommunityDetail(id); }, CM); await p.waitForTimeout(900);
  chk('토큰 만료 → 인증 해제·요약만', await p.evaluate((id) => !state.communityEditAuth[id] && !JSON.stringify(state.communityCurrentAppList).includes('박비밀'), CM));

  // 5. 서버 함수 없음 → 종전 직접 조회
  mode = '501';
  await p.evaluate((id) => { _cmApiDown = false; return renderCommunityDetail(id); }, CM); await p.waitForTimeout(800);
  chk('501 → 직접 조회 폴백', (await sb()).includes('community_applications:select') && await p.evaluate(() => _cmApiDown === true));
  chk('pageerror 없음', errs.length === 0, errs.join(' | '));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  await br.close();
  process.exit(fail ? 1 : 0);
})();
