// /send-sms Cloudflare 함수 단위 테스트 — fetch 목으로 시나리오 검증
// 실행: node tests/send-sms-unit.mjs
import { onRequest } from '../functions/send-sms.js';

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
        return new Response(JSON.stringify(body ?? {}), { status: resp.status ?? 200 });
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

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
