// /community-admin Cloudflare 함수 단위 테스트 — 관리자 인증(카카오/Supabase)·수락(time_blocks)·거절·경합·메일
// 실행: node tests/community-admin-unit.mjs
import { onRequest, meetingSlots } from '../functions/community-admin.js';

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
  chk('모임장 메일: 수신 organizer_email, 제목에 수락, 본문에 모임 링크', em.to === 'bora@test.com' && /수락/.test(em.subject) && em.html.includes(`#community/meeting/${MID}`), em.subject);
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
  chk('meetingSlots: "10:00 ~ 13:00" → [0,2], "22:00 ~ 23:00" → [12,12], 깨진 값 null',
    JSON.stringify(meetingSlots('10:00 ~ 13:00')) === '[0,2]' && JSON.stringify(meetingSlots('22:00 ~ 23:00')) === '[12,12]' && meetingSlots('') === null && meetingSlots('09:00 ~ 10:00') === null);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
