// /community-admin Cloudflare 함수 단위 테스트 — 관리자 인증(카카오/Supabase)·수락(time_blocks)·거절·경합·메일
// 실행: node tests/community-admin-unit.mjs
import { onRequest, meetingSlots, signOrganizer, verifyOrganizer } from '../functions/community-admin.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service' };
const MID = '22222222-2222-4222-8222-222222222222';
const UID = '33333333-3333-4333-8333-333333333333';
const req = (body, origin = 'https://gatherallaround.com') => new Request('https://gatherallaround.com/community-admin', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const run = (body, env = ENV, origin) => onRequest({ request: req(body, origin), env });

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
    calls.push(rec);
    for (const [pat, resp] of routes) {
      if (rec.url.includes(pat) && (!resp.method || resp.method === rec.method)) {
        return new Response(JSON.stringify(resp.body ?? {}), { status: resp.status ?? 200 });
      }
    }
    throw new Error('unexpected fetch: ' + rec.method + ' ' + rec.url);
  };
}
const MEETING = (over = {}) => ({ id: MID, title: '어쿠스틱 잼', meeting_date: '2026-10-20', meeting_time: '19:00 ~ 21:00',
  organizer_name: '박보라', organizer_email: 'bora@test.com', status: 'pending', ...over });
const KAPI = (id) => ['kapi.kakao.com', { body: { id } }];
const GET_MEETING = (m) => [`community_meetings?id=eq.${MID}&select=`, { method: 'GET', body: m ? [m] : [] }];
const PATCH_OK = [`community_meetings?id=eq.${MID}&status=eq.pending`, { method: 'PATCH', body: [{ id: MID }] }];
const PATCH_NONE = [`community_meetings?id=eq.${MID}&status=eq.pending`, { method: 'PATCH', body: [] }];
const BLOCK_OK = ['time_blocks', { method: 'POST', body: [{ id: 'b1' }] }];
const RESEND = ['api.resend.com', { body: { id: 'em1' } }];
const patchBody = () => JSON.parse(calls.find(c => c.method === 'PATCH').body);
const blockCall = () => calls.find(c => c.url.endsWith('/time_blocks') && c.method === 'POST');

// ── 1. 형식·출처
{
  mockFetch([]);
  const r = await run({ action: 'review_meeting', meeting_id: 'x', decision: 'approved', kakao_token: 't' });
  chk('meeting_id 형식 오류 → 400 (외부 호출 없음)', r.status === 400 && calls.length === 0);
  const r2 = await run({ action: 'review_meeting', meeting_id: MID, decision: 'maybe', kakao_token: 't' });
  chk('decision 값 오류 → 400', r2.status === 400);
  const r3 = await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' }, ENV, 'https://evil.example');
  chk('다른 출처 → 403 origin', r3.status === 403 && (await r3.json()).error === 'origin');
  const r4 = await run({ action: 'nope' });
  chk('알 수 없는 액션 → 400', r4.status === 400);
}
// ── 2. 인증: 토큰 없음 / 카카오 비관리자 / 카카오 토큰 무효
{
  mockFetch([]);
  const r = await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved' });
  chk('토큰 없음 → 401', r.status === 401 && (await r.json()).error === 'auth');
  mockFetch([KAPI(1), ['profiles?kakao_id=eq.1', { body: [{ role: '일반' }] }]]);
  const r2 = await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' });
  chk('카카오 비관리자(role 일반) → 403, 모임 조회 없음', r2.status === 403 && !calls.some(c => c.url.includes('community_meetings')));
  mockFetch([['kapi.kakao.com', { status: 401, body: {} }]]);
  const r3 = await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 'bad' });
  chk('카카오 토큰 무효 → 401', r3.status === 401);
}
// ── 3. 수락: ADMIN 백스톱 → status active + reviewed_at + time_blocks(화요일=2, 19:00~20:00 슬롯) + 메일
{
  mockFetch([KAPI(4883868250), GET_MEETING(MEETING()), PATCH_OK, BLOCK_OK, RESEND]);
  const r = await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' }, { ...ENV, RESEND_API_KEY: 'rk' });
  const j = await r.json();
  const pb = patchBody(); const b = JSON.parse(blockCall().body);
  chk('ADMIN 백스톱(프로필 조회 없이) 수락 → ok, status active, time_block, emailed', r.status === 200 && j.ok && j.status === 'active' && j.time_block === true && j.emailed === true
    && !calls.some(c => c.url.includes('/profiles')), JSON.stringify(j));
  chk('PATCH: status active + reviewed_at, 대기 행만(status=eq.pending)', pb.status === 'active' && typeof pb.reviewed_at === 'string', JSON.stringify(pb));
  chk('time_blocks: 2026-10-20(화)=2, 19:00~20:00(표시 21:00 의 이전 슬롯), 사유 [커뮤니티] 제목, 당일 한정', b.day_of_week === 2 && b.start_time === '19:00' && b.end_time === '20:00'
    && b.reason === '[커뮤니티] 어쿠스틱 잼' && b.start_date === '2026-10-20' && b.end_date === '2026-10-20', JSON.stringify(b));
  const em = JSON.parse(calls.find(c => c.url.includes('api.resend.com')).body);
  chk('모임장 메일: 수신 organizer_email, 제목에 수락, 본문에 모임 링크', em.to === 'bora@test.com' && /수락/.test(em.subject) && em.html.includes(`/meet/${MID}`), em.subject);
}
// ── 4. 거절: Supabase 세션(운영 총괄) → status rejected, time_blocks 없음, 메일 키 없으면 발송 없음
{
  mockFetch([['/auth/v1/user', { body: { id: UID } }], [`profiles?id=eq.${UID}`, { body: [{ role: '운영 총괄' }] }], GET_MEETING(MEETING()), PATCH_OK]);
  const r = await run({ action: 'review_meeting', meeting_id: MID, decision: 'rejected', sb_token: 'jwt' });
  const j = await r.json();
  chk('sb_token 운영 총괄 거절 → ok, status rejected, 시간표·메일 없음', r.status === 200 && j.ok && j.status === 'rejected' && j.time_block === false && j.emailed === false
    && !blockCall() && !calls.some(c => c.url.includes('resend')) && j.by === 'sb:' + UID, JSON.stringify(j));
  chk('PATCH 본문 status rejected', patchBody().status === 'rejected');
  mockFetch([['/auth/v1/user', { body: { id: UID } }], [`profiles?id=eq.${UID}`, { body: [{ role: '총괄' }] }]]);
  const r2 = await run({ action: 'review_meeting', meeting_id: MID, decision: 'rejected', sb_token: 'jwt' });
  chk('sb_token 총괄(운영 총괄 아님) → 403', r2.status === 403);
}
// ── 5. 상태·경합: 없음 404 / 이미 처리 409 / PATCH 0행 409 / 시간표 실패해도 수락 유지
{
  mockFetch([KAPI(4883868250), GET_MEETING(null)]);
  chk('모임 없음 → 404', (await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' })).status === 404);
  mockFetch([KAPI(4883868250), GET_MEETING(MEETING({ status: 'active' }))]);
  const r2 = await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' });
  chk('이미 공개된 모임 → 409 not_pending, PATCH 없음', r2.status === 409 && !calls.some(c => c.method === 'PATCH'));
  mockFetch([KAPI(4883868250), GET_MEETING(MEETING()), PATCH_NONE]);
  const r3 = await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' });
  chk('동시 처리(PATCH 0행) → 409, time_blocks 없음', r3.status === 409 && !blockCall());
  mockFetch([KAPI(4883868250), GET_MEETING(MEETING()), PATCH_OK, ['time_blocks', { method: 'POST', status: 500, body: {} }]]);
  const j4 = await (await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' })).json();
  chk('time_blocks 실패 → 수락은 유지(ok, time_block false)', j4.ok === true && j4.status === 'active' && j4.time_block === false);
  mockFetch([KAPI(4883868250), GET_MEETING(MEETING({ meeting_time: '21:00 ~ 23:00', meeting_date: '2026-10-25' })), PATCH_OK, BLOCK_OK]);
  await run({ action: 'review_meeting', meeting_id: MID, decision: 'approved', kakao_token: 't' });
  const b = JSON.parse(blockCall().body);
  chk('막차 슬롯(21:00 ~ 23:00) → 21:00~22:00, 일요일=0', b.start_time === '21:00' && b.end_time === '22:00' && b.day_of_week === 0, JSON.stringify(b));
}
// ── 6. meetingSlots
{
  // 슬롯은 shared/rules.js TIMES(08:00~22:00) 기준 — 종전 사본은 10:00~ 라 오전 8·9시 모임 수락이 실패했다(2026-11-10)
  chk('meetingSlots: "10:00 ~ 13:00" → [2,4], "22:00 ~ 23:00" → [14,14], "08:00 ~ 10:00" → [0,1], 깨진 값 null',
    JSON.stringify(meetingSlots('10:00 ~ 13:00')) === '[2,4]' && JSON.stringify(meetingSlots('22:00 ~ 23:00')) === '[14,14]' && JSON.stringify(meetingSlots('08:00 ~ 10:00')) === '[0,1]' && meetingSlots('') === null && meetingSlots('07:00 ~ 08:00') === null)
}

// ── 7. 신청자 명단(app_*) — 이름·연락처는 본인(연락처 일치)과 모임장(토큰)에게만
{
  const APP = (o = {}) => ({ id: '44444444-4444-4444-8444-444444444444', meeting_id: MID, applicant_name: '김신청', applicant_phone: '010-1234-5678', status: 'pending', form_data: { 세션: '드럼', 경력: '3년' }, ...o });
  const MEET = [`community_meetings?id=eq.${MID}&select=id,form_fields`, { method: 'GET', body: [{ id: MID, form_fields: [{ label: '세션', type: 'select', options: ['기타', '드럼'] }, { label: '경력', type: 'textarea' }] }] }];
  const LIST = (rows) => ['community_applications?select=id,applicant_phone,status,form_data', { method: 'GET', body: rows }];
  const j = async (r) => ({ status: r.status, ...(await r.json()) });
  let r;
  mockFetch([MEET, LIST([APP(), APP({ id: 'x', applicant_phone: '010-9999-0000', status: 'rejected', form_data: { 세션: '기타' } })])]);
  r = await j(await run({ action: 'app_public', meeting_id: MID }));
  chk('app_public: 이름·연락처 없이 선택형 답만', r.ok && r.rows.length === 2 && JSON.stringify(r.rows[0]) === JSON.stringify({ status: 'pending', form_data: { 세션: '드럼' } }) && !JSON.stringify(r).includes('010') && !JSON.stringify(r).includes('김신청') && !JSON.stringify(r).includes('3년'), JSON.stringify(r));
  mockFetch([['community_applications?select=meeting_id,status', { method: 'GET', body: [{ meeting_id: MID, status: 'pending' }, { meeting_id: MID, status: 'rejected' }, { meeting_id: MID, status: 'accepted' }] }]]);
  r = await j(await run({ action: 'app_counts', meeting_ids: [MID, 'bad id'] }));
  chk('app_counts: 거절 제외 수', r.counts[MID] === 2 && !calls[0].url.includes('bad'));
  mockFetch([MEET, LIST([APP()]), ['community_applications?select=id', { method: 'POST', body: [{ id: 'new1' }] }]]);
  r = await j(await run({ action: 'app_apply', meeting_id: MID, name: '김신청', phone: '01012345678', form_data: {} }));
  chk('app_apply: 같은 연락처 중복 409(숫자 기준)', r.status === 409 && r.error === 'dup' && !calls.some(c => c.method === 'POST' && c.url.includes('community_applications')));
  r = await j(await run({ action: 'app_apply', meeting_id: MID, name: ' 새사람 ', phone: '010-2222-3333', form_data: { 세션: '기타' } }));
  const ins = calls.find(c => c.method === 'POST' && c.url.includes('community_applications'));
  chk('app_apply: 저장', r.ok && r.id === 'new1' && JSON.parse(ins.body).applicant_name === '새사람' && JSON.parse(ins.body).applicant_email === null && JSON.parse(ins.body).meeting_id === MID);
  r = await j(await run({ action: 'app_apply', meeting_id: MID, name: '', phone: '1' })); chk('app_apply: 형식 400', r.status === 400);
  mockFetch([['community_applications?select=*&applicant_name=eq.', { method: 'GET', body: [APP(), APP({ id: 'other', applicant_phone: '010-0000-0000' })] }]]);
  r = await j(await run({ action: 'app_mine', name: '김신청', phone: '010 1234 5678' }));
  chk('app_mine: 연락처까지 맞는 것만', r.rows.length === 1 && r.rows[0].applicant_phone === '010-1234-5678');
  r = await j(await run({ action: 'app_mine', name: '김신청', phone: '123' })); chk('app_mine: 형식 400', r.status === 400);
  mockFetch([['community_applications?id=eq.44444444', { method: 'GET', body: [APP()] }], ['community_applications?id=eq.44444444', { method: 'DELETE', body: [] }]]);
  r = await j(await run({ action: 'app_cancel', app_id: APP().id, phone: '01099990000' }));
  chk('app_cancel: 남의 신청은 못 지움', r.cancelled === false && !calls.some(c => c.method === 'DELETE'));
  r = await j(await run({ action: 'app_cancel', app_id: APP().id, phone: '01012345678' }));
  chk('app_cancel: 본인 취소', r.cancelled === true && calls.some(c => c.method === 'DELETE'));

  // 모임장 인증
  mockFetch([['rpc/community_can_edit', { method: 'POST', body: false }], ['functions/v1/verify-meeting-password', { method: 'POST', body: { ok: false } }], ['functions/v1/verify-community-admin', { method: 'POST', body: { ok: false } }]]);
  r = await j(await run({ action: 'app_auth', meeting_id: MID, pw: 'wrong' })); chk('app_auth: 틀린 비밀번호 403', r.status === 403 && !r.token);
  mockFetch([['rpc/community_can_edit', { method: 'POST', body: true }]]);
  r = await j(await run({ action: 'app_auth', meeting_id: MID, pw: 'right' })); chk('app_auth: 토큰 발급', r.ok && typeof r.token === 'string' && r.exp > Date.now());
  const token = r.token;
  mockFetch([['rpc/community_can_edit', { method: 'POST', status: 404, body: {} }], ['functions/v1/verify-meeting-password', { method: 'POST', body: { ok: false } }], ['functions/v1/verify-community-admin', { method: 'POST', body: { ok: true } }]]);
  r = await j(await run({ action: 'app_auth', meeting_id: MID, pw: 'master' })); chk('app_auth: RPC 없어도 마스터 비밀번호(Edge Function)로', r.ok && !!r.token);
  chk('토큰: 다른 모임·변조·만료 거부', await verifyOrganizer(ENV, MID, token) && !(await verifyOrganizer(ENV, UID, token)) && !(await verifyOrganizer(ENV, MID, token.slice(0, -2) + 'zz')) && !(await verifyOrganizer(ENV, MID, token, Date.now() + 3 * 3600e3)) && !(await verifyOrganizer(ENV, MID, (await signOrganizer({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'x' }, MID)).token)));
  mockFetch([['community_applications?select=*&meeting_id=eq.', { method: 'GET', body: [APP()] }]]);
  r = await j(await run({ action: 'app_list', meeting_id: MID })); chk('app_list: 토큰 없으면 401', r.status === 401 && calls.length === 0);
  r = await j(await run({ action: 'app_list', meeting_id: UID, token })); chk('app_list: 다른 모임 토큰 401', r.status === 401);
  r = await j(await run({ action: 'app_list', meeting_id: MID, token })); chk('app_list: 모임장은 전체 명단', r.ok && r.rows[0].applicant_phone === '010-1234-5678');
  mockFetch([[`community_applications?id=eq.${APP().id}&meeting_id=eq.${MID}`, { body: [{ id: APP().id }] }]]);
  r = await j(await run({ action: 'app_status', meeting_id: MID, app_id: APP().id, token, status: 'accepted' }));
  chk('app_status: 이 모임의 신청만 변경', r.changed === 1 && calls[0].method === 'PATCH' && JSON.parse(calls[0].body).status === 'accepted');
  r = await j(await run({ action: 'app_status', meeting_id: MID, app_id: APP().id, token, status: 'hacked' })); chk('app_status: 모르는 상태 400', r.status === 400);
  r = await j(await run({ action: 'app_delete', meeting_id: MID, app_id: APP().id, token })); chk('app_delete', r.changed === 1 && calls[calls.length - 1].method === 'DELETE');
  r = await j(await run({ action: 'app_delete', meeting_id: MID, app_id: APP().id })); chk('app_delete: 토큰 없으면 401', r.status === 401);
  // 상시 모집 전환(app_open_switch)
  const SW = (m, patch = { method: 'PATCH', body: {} }) => [[`community_meetings?id=eq.${MID}&select=id,title,meeting_date`, { method: 'GET', body: m ? [m] : [] }], [`community_meetings?id=eq.${MID}`, patch], ['time_blocks?reason=eq.', { method: 'DELETE', body: [{ id: 'b1' }] }]];
  mockFetch(SW(MEETING()));
  r = await j(await run({ action: 'app_open_switch', meeting_id: MID })); chk('app_open_switch: 토큰 없으면 401(아무것도 안 건드림)', r.status === 401 && calls.length === 0);
  r = await j(await run({ action: 'app_open_switch', meeting_id: MID, token, prev_title: '옛 제목' }));
  const swPatch = calls.find(c => c.method === 'PATCH'), swDel = calls.filter(c => c.method === 'DELETE').map(c => decodeURIComponent(c.url));
  chk('app_open_switch: 날짜·시간을 null 로, 그 모임의 1회 차단(현재 제목·옛 제목, 그 날짜)만 삭제', r.ok && r.switched && r.blocks_removed === 2 && JSON.stringify(JSON.parse(swPatch.body)) === '{"meeting_date":null,"meeting_time":null}' && swDel.length === 2 && swDel[0].includes('reason=eq.[커뮤니티] 어쿠스틱 잼&start_date=eq.2026-10-20&end_date=eq.2026-10-20') && swDel[1].includes('[커뮤니티] 옛 제목'), swDel.join(' | '));
  mockFetch(SW(MEETING({ meeting_date: null, meeting_time: null })));
  r = await j(await run({ action: 'app_open_switch', meeting_id: MID, token })); chk('app_open_switch: 이미 상시 모집이면 그대로', r.ok && r.already && calls.length === 1);
  mockFetch(SW(MEETING(), { method: 'PATCH', status: 400, body: { code: '23502', message: 'null value in column "meeting_date" violates not-null constraint' } }));
  r = await j(await run({ action: 'app_open_switch', meeting_id: MID, token })); chk('app_open_switch: 날짜 칸이 필수면 409 + 마이그레이션 안내(차단은 안 지움)', r.status === 409 && r.error === 'not_null' && /20261111_community_open_meetings/.test(r.message) && !calls.some(c => c.method === 'DELETE'));
  r = await run({ action: 'app_public', meeting_id: MID }, ENV, 'https://evil.example'); chk('app_*: 다른 출처 403', r.status === 403);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
