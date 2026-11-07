// /send-sms Cloudflare 함수 단위 테스트 — fetch 목으로 시나리오 검증
// 실행: node tests/send-sms-unit.mjs
import { onRequest, bandSignupText, bandApproveText, bandRejectText, bandSlotText, bandCabinetLine } from '../functions/send-sms.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = {
  SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service',
  SOLAPI_API_KEY: 'sol-key', SOLAPI_API_SECRET: 'sol-secret', SMS_SENDER: '010-5109-1042',
};
const BK_ID = '11111111-1111-4111-8111-111111111111';

const req = (body, method = 'POST', origin = 'https://gatherallaround.com') =>
  new Request('https://gatherallaround.com/send-sms', {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const run = (body, method = 'POST', env = ENV) => onRequest({ request: req(body, method), env });

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
    calls.push(rec);
    for (const [pat, resp] of routes) {
      if (rec.url.includes(pat) && (!resp.method || resp.method === rec.method)) {
        const body = typeof resp.body === 'function' ? resp.body(rec) : resp.body;
        const status = typeof resp.status === 'function' ? resp.status(rec) : (resp.status ?? 200);
        return new Response(JSON.stringify(body ?? {}), { status });
      }
    }
    throw new Error('unexpected fetch: ' + rec.method + ' ' + rec.url);
  };
}

const NOW = new Date().toISOString();
// 2026-09-05 = 토요일. 18:00~22:00(마지막 슬롯) = 실이용 18-23시 5시간, 주말 40,000/h + 초과 2명 = 210,000원
const BK = (over = {}) => ({
  id: BK_ID, phone: '010-1234-5678', date: '2026-09-05', start_time: '18:00', end_time: '22:00',
  headcount: 7, created_at: NOW, sms_sent_at: null, booking_code: 'AB12CD', ...over,
});
const solapiText = () => {
  const c = calls.find(c => c.url.includes('api.solapi.com/messages'));
  return c ? JSON.parse(c.body).message : null;
};

// ── 1. 입력 검증
{
  mockFetch([]);
  const r = await run({ booking_id: 'not-a-uuid' });
  chk('booking_id UUID 아니면 400', r.status === 400 && calls.length === 0);
}
// ── 2. 정상 발송 — 예약번호·자동취소 정책·조회 안내가 본문에 포함
{
  mockFetch([
    ['performance_bookings?id=eq.' + BK_ID + '&select=', { body: [BK()] }],
    ['sms_sent_at=is.null', { method: 'PATCH', body: [BK()] }],
    ['api.solapi.com/messages', { method: 'POST', body: {} }],
  ]);
  const r = await run({ booking_id: BK_ID });
  const j = await r.json();
  const msg = solapiText();
  chk('정상 발송: ok', r.status === 200 && j.ok === true);
  chk('수신·발신 번호 숫자만', msg && msg.to === '01012345678' && msg.from === '01051091042');
  chk('본문: 일시·인원·주말 요금(210,000원)', !!msg && msg.text.includes('9/5(토) 18-23시(5시간) 7명') && msg.text.includes('210,000원'), (msg?.text || '').slice(0, 80));
  chk('본문: 입금 계좌', !!msg && msg.text.includes('토스뱅크 1000-2274-7678 최경수'));
  chk('본문: 예약번호 안내', !!msg && msg.text.includes('예약번호: AB12CD'));
  chk('본문: 4시간 자동취소 정책', !!msg && msg.text.includes('4시간 안에 입금 확인이 되지 않으면 예약이 자동 취소'));
  chk('본문: 예약 조회 안내', !!msg && msg.text.includes('[공간 대관 > 예약 조회]에서 예약번호와 연락처로'));
  chk('본문: 이모지 없음(EUC-KR 안전)', !!msg && !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(msg.text));
  chk('LMS 제목 지정', !!msg && msg.subject === '게더 올 어라운드 예약 안내');
}
// ── 3. booking_code 없는 구형 건 — 예약번호 줄 없이 발송, 정책 안내는 유지
{
  mockFetch([
    ['performance_bookings?id=eq.' + BK_ID + '&select=', { body: [BK({ booking_code: null })] }],
    ['sms_sent_at=is.null', { method: 'PATCH', body: [BK()] }],
    ['api.solapi.com/messages', { method: 'POST', body: {} }],
  ]);
  const r = await run({ booking_id: BK_ID });
  const msg = solapiText();
  chk('구형 건: 발송 ok + 예약번호 줄 없음', r.status === 200 && !!msg && !msg.text.includes('예약번호: '), (msg?.text || '').slice(0, 60));
  chk('구형 건: 자동취소 정책은 포함', !!msg && msg.text.includes('자동 취소'));
}
// ── 4. 재발송·경합 방지
{
  mockFetch([
    ['performance_bookings?id=eq.' + BK_ID + '&select=', { body: [BK({ sms_sent_at: NOW })] }],
  ]);
  const j = await (await run({ booking_id: BK_ID })).json();
  chk('sms_sent_at 있으면 skip', j.skipped === 'already-sent');

  mockFetch([
    ['performance_bookings?id=eq.' + BK_ID + '&select=', { body: [BK({ created_at: new Date(Date.now() - 16 * 60e3).toISOString() })] }],
  ]);
  const j2 = await (await run({ booking_id: BK_ID })).json();
  chk('접수 15분 초과 건 skip (stale)', j2.skipped === 'stale');

  mockFetch([
    ['performance_bookings?id=eq.' + BK_ID + '&select=', { body: [BK()] }],
    ['sms_sent_at=is.null', { method: 'PATCH', body: [] }],
  ]);
  const j3 = await (await run({ booking_id: BK_ID })).json();
  chk('선점 실패(빈 배열) → already-sent, 솔라피 호출 없음', j3.skipped === 'already-sent'
    && !calls.some(c => c.url.includes('api.solapi.com')));
}
// ── 5. 발송 실패 시 선점 롤백
{
  mockFetch([
    ['performance_bookings?id=eq.' + BK_ID + '&select=', { body: [BK()] }],
    ['sms_sent_at=is.null', { method: 'PATCH', body: [BK()] }],
    ['sms_sent_at=eq.', { method: 'PATCH', body: [] }],
    ['api.solapi.com/messages', { method: 'POST', status: 500, body: { error: 'boom' } }],
  ]);
  const r = await run({ booking_id: BK_ID });
  const rollback = calls.find(c => c.method === 'PATCH' && c.url.includes('sms_sent_at=eq.'));
  chk('솔라피 실패 → 502 + 선점 롤백 PATCH', r.status === 502 && !!rollback
    && JSON.parse(rollback.body).sms_sent_at === null);
}

// ══ 고정 합주팀 문자(2026-11-07) ══════════════════════════════════════════
const TEAM_ID = '22222222-2222-4222-8222-222222222222', ADMIN_ID = '33333333-3333-4333-8333-333333333333', OTHER_ID = '44444444-4444-4444-8444-444444444444';
const TEAM = (over = {}) => ({ id: TEAM_ID, name: '권율', band_name_kr: '벤더', band_name_en: 'Vandor', instruments: 'vandor', email: 'vandor@band.gatheo.kr', member_type: 'band', status: 'pending',
  leader_phone: '010-7484-0121', phone: null, timeslots: ['금_야간'], band_start_date: '2026-11-14', band_expected_months: '6개월', band_fee: null, band_deposit: null, created_at: NOW, ...over });
const ADMIN = { id: ADMIN_ID, name: '최경수', band_name_kr: '게더링', instruments: 'wearegatheo', email: 'wearegatheo@band.gatheo.kr', member_type: 'band', status: 'approved', leader_phone: '010-5109-1042' };
const CLAIMS = [{ day_of_week: 5, start_time: '18:00', end_time: '23:00', status: 'pending' }];
const kb = (str) => [...str].reduce((n, ch) => n + (ch.charCodeAt(0) < 128 ? 1 : 2), 0); // EUC-KR 근사 바이트
const bandRoutes = (team, { logStatus = 201, solapiStatus = 200, claims = CLAIMS } = {}) => [
  ['/auth/v1/user', { body: { id: ADMIN_ID } }],
  ['profiles?id=eq.' + ADMIN_ID, { body: [ADMIN] }],
  ['profiles?id=eq.' + TEAM_ID, { body: [team] }],
  ['band_slot_claims?profile_id=eq.' + TEAM_ID, { body: claims }],
  ['band_sms_log?profile_id=eq.', { method: 'DELETE', body: [] }],
  ['band_sms_log', { method: 'POST', status: logStatus, body: logStatus === 409 ? { code: '23505' } : {} }],
  ['api.solapi.com/messages', { method: 'POST', status: solapiStatus, body: {} }],
];
// ── 6. 본문
{
  const t1 = bandSignupText(TEAM(), CLAIMS);
  chk('접수 문구: 팀명·금요일 18~23시·희망 시작일 11/14(토)·예상 6개월·아이디 vandor·보증금(1개월분) 계좌 안내 → 입금 확인 뒤 승인·문의 번호', ['[벤더] 팀의 고정 합주팀 가입 신청이 접수', '- 신청 타임: 금요일 18~23시', '- 희망 시작일: 11/14(토)부터 · 예상 6개월', '- 로그인 아이디: vandor (밴드 영문명)', '보증금(1개월분 = 4주 이용료, 금액은 운영팀이 확인해 안내)을 아래 계좌로 입금해주시면 운영팀이 입금과 일정을 확인한 뒤 가입을 승인', '토스뱅크 1000-2274-7678 최경수', '등록 회차 이용료는 승인 뒤 시작일 전날까지', '010-5109-1042'].every(x => t1.includes(x)) && !/[\u{1F300}-\u{1FAFF}]/u.test(t1), t1.slice(0, 120));
  chk('접수 문구(띠 이용료로 보증금 금액이 정해진 경우): 「보증금(1개월분, 250,000원)을 아래 계좌로」', bandSignupText(TEAM({ band_deposit: 250000, band_fee: 250000 }), CLAIMS).includes('보증금(1개월분, 250,000원)을 아래 계좌로 입금해주시면'));
  const t2 = bandApproveText(TEAM({ status: 'approved', band_fee: 250000, band_deposit: 250000 }), [{ ...CLAIMS[0], status: 'approved' }]);
  chk('승인 문구: 매주 금요일 18~23시·11/14(토)부터 4주 단위·아이디·보증금(1개월분, 250,000원) 입금 확인 후 확정(입금일 미기록)·이용료 시작일 전날(11/13)·계좌·캐비넷 2만원/숫자 4자리·사용 3주차·보증금 반환',
    ['- 고정 시간: 매주 금요일 18~23시', '- 시작일: 11/14(토)부터 4주 단위', '아이디 vandor · 비밀번호 pw+숫자 4자리', '보증금(1개월분, 250,000원) 입금 확인 후 등록이 확정됩니다', '고정 사용 이용료(250,000원)는 시작일 전날(11/13)까지', '토스뱅크 1000-2274-7678 최경수',
     '[캐비넷 이용 안내]', '회차당 2만원', '숫자 4자리가 캐비넷 비밀번호', '사용 3주차에 입금 안내 문자', '이용 기간 중 1회, 건너뛸 날 3일 전까지 로그인 후 대체 합주를 직접 요청', '보증금은 사용 종료 시 반환'].every(x => t2.includes(x)), t2);
  chk('승인 문구 길이: LMS 한도 2,000byte 안(EUC-KR 근사)', kb(t2) < 2000, kb(t2) + 'byte');
  const t3 = bandApproveText(TEAM({ status: 'approved', band_start_date: null }), []);
  chk('승인 문구(계약 정보·시작일·신청 행 없음): 금액 없이 「보증금(1개월분) 입금 확인 후」·「고정 사용 이용료는 시작일 전날까지」·시작일 추후 안내·timeslots 폴백 「금요일 야간」', t3.includes('보증금(1개월분) 입금 확인 후 등록이 확정') && t3.includes('고정 사용 이용료는 시작일 전날까지') && t3.includes('- 시작일: 추후 안내') && t3.includes('매주 금요일 야간'), t3.split('\n').slice(2, 8).join(' | '));
  chk('승인 문구(보증금 입금일 기록됨): 「보증금(1개월분, 250,000원) 입금이 확인되어 등록이 확정되었습니다」', bandApproveText(TEAM({ status: 'approved', band_deposit: 250000, band_deposit_paid_at: '2026-11-10' }), CLAIMS).includes('보증금(1개월분, 250,000원) 입금이 확인되어 등록이 확정되었습니다.'));
  const t4 = bandRejectText(TEAM({ status: 'rejected' }));
  chk('거절 문구: 아쉽게도 … 자리가 나면 다시 안내 · 문의 번호', t4.includes('[벤더] 팀의 고정 합주팀 가입 신청은 아쉽게도') && t4.includes('자리가 나면 다시 안내') && t4.includes('010-5109-1042'));
  chk('bandSlotText: 여러 타임 요일순 「월요일 18~23시, 금요일 9~14시」', bandSlotText([{ day_of_week: 5, start_time: '09:00', end_time: '14:00' }, { day_of_week: 1, start_time: '18:00', end_time: '23:00' }]) === '월요일 18~23시, 금요일 9~14시');
  // 캐비넷(2026-11-07): 6개월 이상 무료 · 미만 회차당 2만원 · 미응답은 안내만
  const c1 = bandApproveText(TEAM({ status: 'approved', band_cabinet: true, band_expected_months: '6개월' }), CLAIMS);
  const c2 = bandApproveText(TEAM({ status: 'approved', band_cabinet: true, band_expected_months: '3개월' }), CLAIMS);
  const c3 = bandApproveText(TEAM({ status: 'approved', band_cabinet: false }), CLAIMS);
  chk('승인 문구 캐비넷: 사용함+6개월 → 「6개월 이상 사용 팀 무료로 제공」 / 사용함+3개월 → 「회차당 2만원이며, 이용료와 함께」 / 사용 안 함 → 「이용을 원하시면 … 요청사항」',
    c1.includes('신청하신 캐비넷은 6개월 이상 사용 팀 무료로 제공') && !c1.includes('회차당 2만원이며') && c2.includes('신청하신 캐비넷은 회차당 2만원이며, 이용료와 함께') && c3.includes('이용을 원하시면 로그인 후 [요청사항]') && [c1, c2, c3].every(x => x.includes('숫자 4자리가 캐비넷 비밀번호')));
  chk('접수 문구 캐비넷 줄: 사용함(6개월 이상 무료) / 사용함(회차당 2만원) / 사용 안 함 / 미응답은 줄 없음', bandSignupText(TEAM({ band_cabinet: true, band_expected_months: '6개월' }), CLAIMS).includes('- 캐비넷: 사용함 (6개월 이상 무료)') && bandSignupText(TEAM({ band_cabinet: true, band_expected_months: '2개월' }), CLAIMS).includes('- 캐비넷: 사용함 (회차당 2만원, 이용료와 함께 입금)') && bandSignupText(TEAM({ band_cabinet: false }), CLAIMS).includes('- 캐비넷: 사용 안 함') && !bandSignupText(TEAM(), CLAIMS).includes('- 캐비넷') && bandCabinetLine(TEAM({ band_cabinet: true, band_expected_months: null })) === '사용함 (6개월 이상 무료, 미만 회차당 2만원)');
  chk('승인 문구(캐비넷 사용) 길이도 2,000byte 안', kb(c2) < 2000, kb(c2) + 'byte');
  if (process.env.SHOW_TEXT) console.log('\n──── 접수 ────\n' + t1 + '\n──── 승인 ────\n' + t2 + '\n──── 승인(캐비넷 3개월) ────\n' + c2 + '\n──── 거절 ────\n' + t4 + '\n');
}
// ── 7. 가입 접수(공개): 선점 → 발송, 제목·수신번호
{
  mockFetch(bandRoutes(TEAM()));
  const r = await run({ band_signup_id: TEAM_ID }); const j = await r.json();
  const m = solapiText(); const log = calls.find(c => c.url.endsWith('/band_sms_log') && c.method === 'POST');
  chk('접수 문자: 200 ok · band_sms_log insert(signup) 뒤 솔라피 발송 · 수신 01074840121 · 제목 「가입 접수」 · 가려진 번호 응답', r.status === 200 && j.ok && j.to === '010****0121' && !!log && JSON.parse(log.body).kind === 'signup' && m && m.to === '01074840121' && m.subject === '게더 올 어라운드 가입 접수' && m.text.includes('가입 신청이 접수'), JSON.stringify(j));
  chk('접수 문자: 인증 호출 없음(공개 액션)', !calls.some(c => c.url.includes('/auth/v1/user')));
}
{
  mockFetch(bandRoutes(TEAM(), { logStatus: 409 }));
  const j = await (await run({ band_signup_id: TEAM_ID })).json();
  chk('접수 문자 중복(PK 409) → already-sent, 솔라피 호출 없음', j.skipped === 'already-sent' && !calls.some(c => c.url.includes('api.solapi.com')));
  mockFetch(bandRoutes(TEAM({ created_at: new Date(Date.now() - 20 * 60e3).toISOString() })));
  chk('접수 문자: 신청 20분 지난 건 → stale', (await (await run({ band_signup_id: TEAM_ID })).json()).skipped === 'stale');
  mockFetch(bandRoutes(TEAM({ status: 'approved' })));
  chk('접수 문자: 이미 승인된 팀 → 409 status', (await run({ band_signup_id: TEAM_ID })).status === 409);
  mockFetch(bandRoutes(TEAM(), { logStatus: 404 }));
  const j2 = await (await run({ band_signup_id: TEAM_ID })).json();
  chk('접수 문자: band_sms_log 표 없음(404) → no-table 안내, 발송 안 함', j2.skipped === 'no-table' && /20261107_band_sms_log/.test(j2.message) && !calls.some(c => c.url.includes('api.solapi.com')));
  // band_cabinet 컬럼 마이그레이션 전: select 400(column … band_cabinet) → 컬럼 없이 재조회해 정상 발송
  mockFetch([
    ['/auth/v1/user', { body: { id: ADMIN_ID } }],
    ['profiles?id=eq.' + TEAM_ID, { status: (rec) => rec.url.includes('band_cabinet') ? 400 : 200, body: (rec) => rec.url.includes('band_cabinet') ? { code: '42703', message: 'column profiles.band_cabinet does not exist' } : [TEAM()] }],
    ['band_slot_claims?profile_id=eq.' + TEAM_ID, { body: CLAIMS }],
    ['band_sms_log', { method: 'POST', status: 201, body: {} }],
    ['api.solapi.com/messages', { method: 'POST', body: {} }],
  ]);
  const jf = await (await run({ band_signup_id: TEAM_ID })).json();
  chk('profiles 조회 400(band_cabinet 컬럼 없음) → 컬럼 없이 재조회 후 발송', jf.ok === true && calls.filter(c => c.url.includes('profiles?id=eq.' + TEAM_ID)).length === 2 && !calls[1].url.includes('band_cabinet'), JSON.stringify(jf));
  mockFetch([]);
  chk('band_signup_id UUID 아니면 400', (await run({ band_signup_id: 'nope' })).status === 400);
  const j3 = await (await run({ band_signup_id: TEAM_ID }, 'POST', { ...ENV, SOLAPI_API_KEY: '' })).json();
  chk('솔라피 키 없음 → 접수는 조용히 sms-disabled', j3.skipped === 'sms-disabled');
}
// ── 8. 승인/거절(운영자 세션)
{
  mockFetch(bandRoutes(TEAM({ status: 'approved', band_fee: 250000, band_deposit: 250000 }), { claims: [{ ...CLAIMS[0], status: 'approved' }] }));
  const r = await run({ band_profile_id: TEAM_ID, kind: 'approve', sb_token: 'tok' }); const j = await r.json(); const m = solapiText();
  chk('승인 문자: 세션 검증 → 운영자 확인 → 팀(approved) → log(approve, return=minimal) → 발송(제목 「가입 승인」, 금액 포함)', r.status === 200 && j.ok && calls.some(c => c.url.includes('/auth/v1/user')) && m && m.subject === '게더 올 어라운드 가입 승인' && m.text.includes('보증금(1개월분, 250,000원)') && m.text.includes('매주 금요일 18~23시') && calls.some(c => c.url.includes('profiles?id=eq.' + TEAM_ID) && c.url.includes('band_deposit_paid_at')) && calls.find(c => c.url.endsWith('/band_sms_log') && c.method === 'POST').headers.Prefer === 'return=minimal', JSON.stringify(j));
  chk('승인 문자: 승인 상태 신청 행만 조회(status=in.(approved))', calls.some(c => c.url.includes('band_slot_claims') && c.url.includes('status=in.(approved)')));
  mockFetch(bandRoutes(TEAM({ status: 'approved' })));
  chk('승인 문자: sb_token 없음 → 401', (await run({ band_profile_id: TEAM_ID, kind: 'approve' })).status === 401);
  mockFetch([['/auth/v1/user', { body: { id: OTHER_ID } }], ['profiles?id=eq.' + OTHER_ID, { body: [TEAM({ id: OTHER_ID, instruments: 'vandor' })] }]]);
  chk('승인 문자: 운영 계정이 아니면 403', (await run({ band_profile_id: TEAM_ID, kind: 'approve', sb_token: 'tok' })).status === 403);
  mockFetch(bandRoutes(TEAM({ status: 'pending' })));
  chk('승인 문자: 팀이 아직 pending 이면 409 status', (await run({ band_profile_id: TEAM_ID, kind: 'approve', sb_token: 'tok' })).status === 409);
  mockFetch(bandRoutes(TEAM({ status: 'approved' }), { logStatus: 409 }));
  const dup = await run({ band_profile_id: TEAM_ID, kind: 'approve', sb_token: 'tok' });
  chk('승인 문자 중복 → 409 already-sent(운영자에겐 오류로)', dup.status === 409 && (await dup.json()).skipped === 'already-sent');
  mockFetch(bandRoutes(TEAM({ status: 'approved' })));
  await run({ band_profile_id: TEAM_ID, kind: 'approve', sb_token: 'tok', resend: true });
  chk('재발송(resend): log upsert(resolution=merge-duplicates) 로 다시 보냄', calls.find(c => c.url.endsWith('/band_sms_log') && c.method === 'POST').headers.Prefer.includes('merge-duplicates') && !!solapiText());
  mockFetch(bandRoutes(TEAM({ status: 'rejected' })));
  const rj = await (await run({ band_profile_id: TEAM_ID, kind: 'reject', sb_token: 'tok' })).json(); const rm = solapiText();
  chk('거절 문자: rejected 팀 → 제목 「가입 안내」 · 아쉽게도 문구', rj.ok && rm.subject === '게더 올 어라운드 가입 안내' && rm.text.includes('아쉽게도'));
  mockFetch(bandRoutes(TEAM({ status: 'approved' }), { solapiStatus: 500 }));
  const f = await run({ band_profile_id: TEAM_ID, kind: 'approve', sb_token: 'tok' });
  const del = calls.find(c => c.method === 'DELETE' && c.url.includes('band_sms_log?profile_id=eq.' + TEAM_ID) && c.url.includes('kind=eq.approve') && c.url.includes('sent_at=eq.'));
  chk('솔라피 실패 → 502 + 내 선점 행 DELETE(sent_at 일치)', f.status === 502 && !!del);
  const dis = await (await run({ band_profile_id: TEAM_ID, kind: 'approve', sb_token: 'tok' }, 'POST', { ...ENV, SMS_SENDER: '' })).json();
  chk('솔라피 키 없음 → 운영자 호출은 400 sms-disabled 안내', dis.error === 'sms-disabled' && /솔라피/.test(dis.message));
}
// ── 9. 운영자 테스트 발송(본인 번호·[테스트]·기록 없음)
{
  mockFetch(bandRoutes(TEAM()));
  const j = await (await run({ band_test: 'approve', sb_token: 'tok' })).json(); const m = solapiText();
  chk('band_test approve: 관리자 본인 번호(01051091042)로 [테스트] 승인 문구 · 제목 (테스트) · band_sms_log 기록 없음', j.ok && j.test && m.to === '01051091042' && m.text.startsWith('[테스트] ') && m.text.includes('[게더링] 팀의 고정 합주팀 가입이 승인') && m.text.includes('매주 금요일 18~23시') && m.subject.endsWith('(테스트)') && !calls.some(c => c.url.includes('band_sms_log')), JSON.stringify(j));
  mockFetch(bandRoutes(TEAM()));
  chk('band_test 모르는 종류 → 400', (await run({ band_test: 'nope', sb_token: 'tok' })).status === 400);
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
