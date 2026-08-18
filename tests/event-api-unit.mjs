// /event-api Cloudflare 함수 단위 테스트 — fetch 목으로 시나리오 검증
// 실행: node tests/event-api-unit.mjs
import { onRequest } from '../functions/event-api.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service' };
const EV_ID = '11111111-1111-4111-8111-111111111111';
const TK_ID = '22222222-2222-4222-8222-222222222222';

const req = (body, method = 'POST', origin = 'https://gatherallaround.co.kr') =>
  new Request('https://gatherallaround.co.kr/event-api', {
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

const FUTURE = new Date(Date.now() + 7 * 86400e3).toISOString();
const PAST = new Date(Date.now() - 3600e3).toISOString();
const TICKET = (over = {}) => ({
  id: TK_ID, event_id: EV_ID, code: 'ABCXYZ', buyer_name: '홍길동', buyer_phone: '01012345678',
  qty: 2, status: 'confirmed', checked_in_at: null, created_at: PAST,
  events: { id: EV_ID, title: '여름 공연', host_name: '밴드X', venue: '게더', starts_at: FUTURE, price: 15000, bank_info: '토스 111', status: 'published' },
  ...over,
});

// ── 1. CORS/메서드
{
  mockFetch([]);
  const r = await run(null, 'OPTIONS');
  chk('OPTIONS: 허용 Origin 반사', r.headers.get('Access-Control-Allow-Origin') === 'https://gatherallaround.co.kr');
  const r2 = await onRequest({ request: req({}, 'OPTIONS', 'https://evil.example'), env: ENV });
  chk('비허용 Origin → 기본 도메인 고정', r2.headers.get('Access-Control-Allow-Origin') === 'https://gatherallaround.co.kr');
  const r3 = await run(null, 'PUT');
  chk('PUT: 405', r3.status === 405);
}
// ── 2. GET 진단
{
  mockFetch([
    ['events?select=id', { body: [] }],
    ['event_tickets?select=id', { body: [] }],
    ['rpc/book_event_ticket', { method: 'POST', body: { ok: false, error: 'not_found' } }],
  ]);
  const j = await (await run(null, 'GET')).json();
  chk('진단: 테이블·RPC 확인', j['환경변수_SUPABASE'] === true && j['events_테이블'] === true && j['book_rpc'] === true, JSON.stringify(j).slice(0, 120));
}
// ── 3. book 입력 검증 (fetch 0회)
{
  mockFetch([]);
  const cases = [
    [{ action: 'book', event_id: 'x', name: 'a', phone: '01012345678', qty: 1 }, 'bad_event'],
    [{ action: 'book', event_id: EV_ID, name: '', phone: '01012345678', qty: 1 }, 'bad_name'],
    [{ action: 'book', event_id: EV_ID, name: 'a', phone: '021234567', qty: 1 }, 'bad_phone'],
    [{ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 0 }, 'bad_qty'],
    [{ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 'x' }, 'bad_qty'],
  ];
  let ok = true;
  for (const [b, code] of cases) {
    const r = await run(b); const j = await r.json();
    if (r.status !== 400 || j.error !== code) { ok = false; console.log('   ✗', code, r.status, j.error); }
  }
  chk('book: 형식 검증 5종 → 400 + fetch 0회', ok && calls.length === 0);
}
// ── 4. book 성공 (RPC 패스스루 + 코드 형식)
{
  let sentCode = null;
  mockFetch([['rpc/book_event_ticket', { method: 'POST', body: (rec) => {
    sentCode = JSON.parse(rec.body).p_code;
    return { ok: true, ticket: { code: sentCode, status: 'pending_payment' }, event: { id: EV_ID, price: 15000 } };
  } }]]);
  const j = await (await run({ action: 'book', event_id: EV_ID, name: ' 홍길동 ', phone: '010-1234-5678', qty: 2 })).json();
  const sent = JSON.parse(calls[0].body);
  chk('book: 성공 패스스루', j.ok === true && j.ticket.code === sentCode);
  chk('book: 코드 6자리(혼동문자 제외) 서버 생성', /^[A-HJ-NP-Z2-9]{6}$/.test(sentCode), sentCode);
  chk('book: 이름 trim + 전화 정규화', sent.p_name === '홍길동' && sent.p_phone === '01012345678');
  chk('book: service key 헤더', calls[0].headers.apikey === 'sk-service');
}
// ── 5. book: code_collision 재시도 → 성공 / 5회 초과 포기
{
  let n = 0;
  mockFetch([['rpc/', { method: 'POST', body: () => (++n < 3 ? { ok: false, error: 'code_collision' } : { ok: true, ticket: {}, event: {} }) }]]);
  const j = await (await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 })).json();
  chk('book: 충돌 2회 후 3번째 성공', j.ok === true && n === 3);
  mockFetch([['rpc/', { method: 'POST', body: { ok: false, error: 'code_collision' } }]]);
  const r2 = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 });
  chk('book: 5회 모두 충돌 → 502 + 5회 시도', r2.status === 502 && calls.length === 5);
}
// ── 6. book: RPC 에러 매핑
{
  mockFetch([['rpc/', { method: 'POST', body: { ok: false, error: 'sold_out', remaining: 3 } }]]);
  const r = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 5 });
  const j = await r.json();
  chk('book: sold_out → 409 + 잔여석 메시지', r.status === 409 && j.remaining === 3 && j.message.includes('잔여 3석'));
  mockFetch([['rpc/', { method: 'POST', body: { ok: false, error: 'duplicate' } }]]);
  const r2 = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 });
  chk('book: duplicate → 409', r2.status === 409);
  mockFetch([['rpc/', { method: 'POST', body: { ok: false, error: 'started' } }]]);
  const r3 = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 });
  chk('book: started → 409', r3.status === 409);
}
// ── 7. lookup: 코드 존재+전화 불일치 = 코드 없음과 동일 404
{
  mockFetch([['event_tickets?code=eq.ABCXYZ', { body: [TICKET()] }]]);
  const rA = await run({ action: 'lookup', code: 'abcxyz', phone: '01099999999' });
  mockFetch([['event_tickets?code=eq.QQQQQQ', { body: [] }]]);
  const rB = await run({ action: 'lookup', code: 'QQQQQQ', phone: '01012345678' });
  const [jA, jB] = [await rA.json(), await rB.json()];
  chk('lookup: 전화 불일치와 코드 없음이 동일 응답', rA.status === 404 && rB.status === 404 && jA.message === jB.message);
}
// ── 8. lookup 성공 (소문자 code 정규화 + event 분리)
{
  mockFetch([['event_tickets?code=eq.ABCXYZ', { body: [TICKET()] }]]);
  const j = await (await run({ action: 'lookup', code: ' abcxyz ', phone: '010-1234-5678' })).json();
  chk('lookup: 성공 + ticket/event 분리', j.ok === true && j.ticket.code === 'ABCXYZ' && j.event.title === '여름 공연' && !j.ticket.events);
}
// ── 9. cancel 성공 (조건부 PATCH)
{
  mockFetch([
    ['event_tickets?code=eq.ABCXYZ', { body: [TICKET()] }],
    ['status=in.(pending_payment,confirmed)', { method: 'PATCH', body: [{ id: TK_ID, status: 'cancelled' }] }],
  ]);
  const j = await (await run({ action: 'cancel', code: 'ABCXYZ', phone: '01012345678' })).json();
  const patch = calls.find(c => c.method === 'PATCH');
  chk('cancel: 성공 + cancelled_by=buyer', j.ok === true && JSON.parse(patch.body).cancelled_by === 'buyer');
  chk('cancel: 조건부 PATCH(미체크인 한정)', patch.url.includes('checked_in_at=is.null'));
}
// ── 10. cancel 차단 3종
{
  mockFetch([['event_tickets?code=eq.ABCXYZ', { body: [TICKET({ checked_in_at: PAST })] }]]);
  const r1 = await run({ action: 'cancel', code: 'ABCXYZ', phone: '01012345678' });
  chk('cancel: 입장 완료 → 409', r1.status === 409 && (await r1.json()).error === 'checked_in');
  mockFetch([['event_tickets?code=eq.ABCXYZ', { body: [TICKET({ events: { ...TICKET().events, starts_at: PAST } })] }]]);
  const r2 = await run({ action: 'cancel', code: 'ABCXYZ', phone: '01012345678' });
  chk('cancel: 공연 시작 후 → 409', r2.status === 409 && (await r2.json()).error === 'started');
  mockFetch([
    ['event_tickets?code=eq.ABCXYZ', { body: [TICKET()] }],
    ['status=in.(pending_payment,confirmed)', { method: 'PATCH', body: [] }],
  ]);
  const r3 = await run({ action: 'cancel', code: 'ABCXYZ', phone: '01012345678' });
  chk('cancel: 갱신 0행(경합) → 409', r3.status === 409 && (await r3.json()).error === 'not_cancellable');
}
// ── 11. 알 수 없는 action
{
  mockFetch([]);
  const r = await run({ action: 'hack' });
  chk('unknown action → 400', r.status === 400);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
