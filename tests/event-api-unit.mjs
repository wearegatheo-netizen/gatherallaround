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
    ['event_ticket_seats?select=code', { body: [] }],
    ['rpc/book_event_ticket', { method: 'POST', body: { ok: false, error: 'not_found' } }],
  ]);
  const j = await (await run(null, 'GET')).json();
  chk('진단: 테이블(좌석 포함)·RPC 확인', j['환경변수_SUPABASE'] === true && j['events_테이블'] === true
    && j['event_ticket_seats_테이블'] === true && j['book_rpc'] === true, JSON.stringify(j).slice(0, 120));
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
// ── 4. book 성공 (RPC 패스스루 + 코드 형식 + 매수별 좌석 QR)
{
  let sentCode = null, seatStore = [];
  mockFetch([
    ['events?id=eq.' + EV_ID + '&select=starts_at', { body: [{ starts_at: FUTURE }] }],
    ['rpc/book_event_ticket', { method: 'POST', body: (rec) => {
      sentCode = JSON.parse(rec.body).p_code;
      return { ok: true, ticket: { id: TK_ID, code: sentCode, qty: 2, status: 'pending_payment' }, event: { id: EV_ID, price: 15000 } };
    } }],
    ['event_ticket_seats?ticket_id=', { method: 'GET', body: () => seatStore }],
    ['event_ticket_seats', { method: 'POST', body: (rec) => {
      seatStore = JSON.parse(rec.body).map(x => ({ code: x.code, seat_no: x.seat_no, checked_in_at: null }));
      return seatStore;
    } }],
  ]);
  const j = await (await run({ action: 'book', event_id: EV_ID, name: ' 홍길동 ', phone: '010-1234-5678', qty: 2 })).json();
  const rpcCall = calls.find(c => c.url.includes('rpc/book_event_ticket'));
  const sent = JSON.parse(rpcCall.body);
  chk('book: 성공 패스스루', j.ok === true && j.ticket.code === sentCode);
  chk('book: 코드 6자리(혼동문자 제외) 서버 생성', /^[A-HJ-NP-Z2-9]{6}$/.test(sentCode), sentCode);
  chk('book: 이름 trim + 전화 정규화', sent.p_name === '홍길동' && sent.p_phone === '01012345678');
  chk('book: service key 헤더', rpcCall.headers.apikey === 'sk-service');
  chk('book: 매수별 좌석 QR — 1번=예매번호, 2번=별도 6자리 코드', Array.isArray(j.seats) && j.seats.length === 2
    && j.seats[0].code === sentCode && j.seats[1].code !== sentCode && /^[A-HJ-NP-Z2-9]{6}$/.test(j.seats[1].code),
    JSON.stringify(j.seats));
}
// ── 5. book: code_collision 재시도 → 성공 / 5회 초과 포기
{
  let n = 0;
  mockFetch([
    ['events?id=', { body: [] }],
    ['rpc/', { method: 'POST', body: () => (++n < 3 ? { ok: false, error: 'code_collision' } : { ok: true, ticket: {}, event: {} }) }],
    ['event_ticket_seats', { body: [] }],
  ]);
  const j = await (await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 })).json();
  chk('book: 충돌 2회 후 3번째 성공', j.ok === true && n === 3);
  mockFetch([['events?id=', { body: [] }], ['rpc/', { method: 'POST', body: { ok: false, error: 'code_collision' } }]]);
  const r2 = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 });
  chk('book: 5회 모두 충돌 → 502 + 5회 시도', r2.status === 502 && calls.filter(c => c.url.includes('rpc/')).length === 5);
}
// ── 6. book: RPC 에러 매핑 + 시작 시간 마감
{
  mockFetch([['events?id=', { body: [] }], ['rpc/', { method: 'POST', body: { ok: false, error: 'sold_out', remaining: 3 } }]]);
  const r = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 5 });
  const j = await r.json();
  chk('book: sold_out → 409 + 잔여석 메시지', r.status === 409 && j.remaining === 3 && j.message.includes('잔여 3석'));
  mockFetch([['events?id=', { body: [] }], ['rpc/', { method: 'POST', body: { ok: false, error: 'duplicate' } }]]);
  const r2 = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 });
  chk('book: duplicate → 409', r2.status === 409);
  mockFetch([['events?id=', { body: [] }], ['rpc/', { method: 'POST', body: { ok: false, error: 'started' } }]]);
  const r3 = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 });
  chk('book: started(RPC) → 409', r3.status === 409);
  mockFetch([['events?id=', { body: [{ starts_at: PAST }] }]]);
  const r4 = await run({ action: 'book', event_id: EV_ID, name: 'a', phone: '01012345678', qty: 1 });
  chk('book: 공연 시작 후 → 409 started (RPC 미호출)', r4.status === 409 && (await r4.json()).error === 'started'
    && !calls.some(c => c.url.includes('rpc/')));
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
// ── 8. lookup 성공 (소문자 code 정규화 + event 분리 + 좌석 지연 생성)
{
  let seatStore = [];
  mockFetch([
    ['event_tickets?code=eq.ABCXYZ', { body: [TICKET()] }],
    ['event_ticket_seats?ticket_id=', { method: 'GET', body: () => seatStore }],
    ['event_ticket_seats', { method: 'POST', body: (rec) => {
      seatStore = JSON.parse(rec.body).map(x => ({ code: x.code, seat_no: x.seat_no, checked_in_at: null }));
      return seatStore;
    } }],
  ]);
  const j = await (await run({ action: 'lookup', code: ' abcxyz ', phone: '010-1234-5678' })).json();
  chk('lookup: 성공 + ticket/event 분리', j.ok === true && j.ticket.code === 'ABCXYZ' && j.event.title === '여름 공연' && !j.ticket.events);
  chk('lookup: 과거 예매도 좌석 보충(qty 2 → 좌석 2, 1번=예매번호)', j.seats.length === 2
    && j.seats[0].code === 'ABCXYZ' && j.seats[0].seat_no === 1 && j.seats[1].code !== 'ABCXYZ', JSON.stringify(j.seats));
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
// ── 10b. cancel_seat: 티켓 1장(좌석) 부분 취소
{
  const seatLookup = (tOver = {}, sOver = {}) => ['event_ticket_seats?code=eq.ZZ9PQR&select', { method: 'GET',
    body: [{ code: 'ZZ9PQR', seat_no: 2, checked_in_at: null, cancelled_at: null, ...sOver,
      event_tickets: { id: TK_ID, code: 'ABCXYZ', buyer_phone: '01012345678', qty: 3, status: 'confirmed', checked_in_at: null,
        events: { id: EV_ID, title: '공연', starts_at: FUTURE }, ...tOver } }] }];
  const SEATS3 = [
    { code: 'ABCXYZ', seat_no: 1, checked_in_at: null, cancelled_at: null },
    { code: 'ZZ9PQR', seat_no: 2, checked_in_at: null, cancelled_at: null },
    { code: 'KM4TUV', seat_no: 3, checked_in_at: null, cancelled_at: null }];

  // 성공: 3장 중 1장 취소 → 좌석 cancelled + qty 3→2 (조건부 차감)
  mockFetch([seatLookup(),
    ['event_ticket_seats?ticket_id=eq.' + TK_ID + '&select=code,seat_no', { method: 'GET', body: SEATS3 }],
    ['event_ticket_seats?code=eq.ZZ9PQR&cancelled_at=is.null&checked_in_at=is.null', { method: 'PATCH', body: [{ code: 'ZZ9PQR' }] }],
    ['event_tickets?id=eq.' + TK_ID + '&select=qty,status', { method: 'GET', body: [{ qty: 3, status: 'confirmed' }] }],
    ['event_tickets?id=eq.' + TK_ID + '&qty=eq.3', { method: 'PATCH', body: [{ id: TK_ID, qty: 2 }] }],
    ['event_tickets?id=eq.' + TK_ID + '&select=*', { method: 'GET', body: [{ id: TK_ID, code: 'ABCXYZ', qty: 2, status: 'confirmed' }] }],
  ]);
  const j = await (await run({ action: 'cancel_seat', code: 'zz9pqr', phone: '010-1234-5678' })).json();
  const dq = calls.find(c => c.method === 'PATCH' && c.url.includes('qty=eq.3'));
  chk('cancel_seat: 3장 중 1장 취소 → 좌석 취소 + qty 3→2', j.ok === true && j.whole === false
    && j.ticket.qty === 2 && dq && JSON.parse(dq.body).qty === 2, JSON.stringify(j).slice(0, 100));

  // 입장한 좌석 → 409 / 공연 시작 후 → 409 / 전화 불일치 → 404
  mockFetch([seatLookup({}, { checked_in_at: PAST })]);
  chk('cancel_seat: 입장한 좌석 → 409', (await (await run({ action: 'cancel_seat', code: 'ZZ9PQR', phone: '01012345678' })).json()).error === 'checked_in');
  mockFetch([seatLookup({ events: { id: EV_ID, title: '공연', starts_at: PAST } })]);
  chk('cancel_seat: 공연 시작 후 → 409 started', (await (await run({ action: 'cancel_seat', code: 'ZZ9PQR', phone: '01012345678' })).json()).error === 'started');
  mockFetch([seatLookup()]);
  chk('cancel_seat: 전화 불일치 → 404 (존재 은닉)', (await run({ action: 'cancel_seat', code: 'ZZ9PQR', phone: '01099999999' })).status === 404);

  // 마지막 활성 좌석 → 예매 전체 취소로 전환
  mockFetch([
    ['event_ticket_seats?code=eq.ZZ9PQR&select', { method: 'GET',
      body: [{ code: 'ZZ9PQR', seat_no: 1, checked_in_at: null, cancelled_at: null,
        event_tickets: { id: TK_ID, code: 'ZZ9PQR', buyer_phone: '01012345678', qty: 1, status: 'pending_payment', checked_in_at: null,
          events: { id: EV_ID, title: '공연', starts_at: FUTURE } } }] }],
    ['event_ticket_seats?ticket_id=eq.' + TK_ID + '&select=code,seat_no', { method: 'GET',
      body: [{ code: 'ZZ9PQR', seat_no: 1, checked_in_at: null, cancelled_at: null }] }],
    ['event_tickets?id=eq.' + TK_ID + '&status=in.(pending_payment,confirmed)', { method: 'PATCH', body: [{ id: TK_ID, status: 'cancelled' }] }],
    ['event_ticket_seats?code=eq.ZZ9PQR', { method: 'PATCH', body: [] }],
    ['event_tickets?id=eq.' + TK_ID + '&select=*', { method: 'GET', body: [{ id: TK_ID, qty: 1, status: 'cancelled' }] }],
  ]);
  const j5 = await (await run({ action: 'cancel_seat', code: 'ZZ9PQR', phone: '01012345678' })).json();
  const wp = calls.find(c => c.method === 'PATCH' && c.url.includes('status=in.'));
  chk('cancel_seat: 마지막 1장 → 예매 전체 취소(cancelled_by=buyer)', j5.ok === true && j5.whole === true
    && j5.ticket.status === 'cancelled' && JSON.parse(wp.body).cancelled_by === 'buyer');
}
// ── 11. 알 수 없는 action
{
  mockFetch([]);
  const r = await run({ action: 'hack' });
  chk('unknown action → 400', r.status === 400);
}

// ═══════════ 호스트 액션 (멀티팀 + 공동호스트) ═══════════
const HOST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM = { id: HOST_ID, kakao_id: '777', name: '밴드X', bio: '소개', sns: 'instagram.com/x', bank_info: '토스 111' };
const KAPI_OK = ['kapi.kakao.com', { body: { id: 777, kakao_account: { profile: { nickname: '닉네임' } } } }];
const KAPI_ADMIN = ['kapi.kakao.com', { body: { id: 4883868250 } }];
const MEMBERSHIP = (role) => [`event_host_members?host_id=eq.${HOST_ID}&kakao_id=eq.777`, { body: role ? [{ role }] : [] }];
const EVENT_ROW = (over = {}) => ({ id: EV_ID, host_id: HOST_ID, host_name: '밴드X', title: '공연', venue: '게더',
  starts_at: FUTURE, capacity: 40, price: 15000, bank_info: '토스 111', max_per_booking: 4, status: 'published', ...over });

// ── 12. 토큰 무효 → 401
{
  mockFetch([['kapi.kakao.com', { status: 401, body: { code: -401 } }]]);
  const r = await run({ action: 'my_events', kakao_token: 'expired', host_id: HOST_ID });
  chk('호스트: 카카오 토큰 무효 → 401', r.status === 401 && (await r.json()).error === 'auth');
  mockFetch([]);
  const r2 = await run({ action: 'my_events', kakao_token: '' });
  chk('호스트: 토큰 없음 → 401 + kapi 미호출', r2.status === 401 && calls.length === 0);
}
// ── 13. host_me: 팀 배열 반환
{
  mockFetch([KAPI_OK, ['event_host_members?kakao_id=eq.777', { body: [{ role: 'owner', event_hosts: TEAM }] }]]);
  const j = await (await run({ action: 'host_me', kakao_token: 't' })).json();
  chk('host_me: 팀 배열 + my_role', j.ok === true && j.teams.length === 1 && j.teams[0].id === HOST_ID && j.teams[0].my_role === 'owner');
  mockFetch([KAPI_OK, ['event_host_members?kakao_id=eq.777', { body: [] }]]);
  const j2 = await (await run({ action: 'host_me', kakao_token: 't' })).json();
  chk('host_me: 팀 없음 → 빈 배열', j2.ok === true && j2.teams.length === 0);
}
// ── 14. create_team / update_team
{
  mockFetch([KAPI_OK,
    ['event_hosts', { method: 'POST', body: [TEAM] }],
    ['event_host_members', { method: 'POST', body: [] }]]);
  const j = await (await run({ action: 'create_team', kakao_token: 't', name: ' 밴드X ', bio: '소개', sns: 'instagram.com/x' })).json();
  const memberIns = calls.find(c => c.url.endsWith('/event_host_members') && c.method === 'POST');
  chk('create_team: 팀 생성 + owner 멤버십(닉네임 저장)', j.ok === true && j.team.my_role === 'owner'
    && JSON.parse(memberIns.body).role === 'owner' && JSON.parse(memberIns.body).name === '닉네임');

  mockFetch([KAPI_OK, MEMBERSHIP('member')]);
  const r2 = await run({ action: 'update_team', kakao_token: 't', host_id: HOST_ID, name: 'x' });
  chk('update_team: 공동호스트(member)는 403', r2.status === 403 && (await r2.json()).error === 'not_team_owner');

  mockFetch([KAPI_OK, MEMBERSHIP('owner'),
    [`events?host_id=eq.${HOST_ID}`, { method: 'PATCH', body: [] }],
    [`event_hosts?id=eq.${HOST_ID}`, { method: 'PATCH', body: [{ ...TEAM, name: '새이름' }] }]]);
  const j3 = await (await run({ action: 'update_team', kakao_token: 't', host_id: HOST_ID, name: '새이름' })).json();
  const sync = calls.find(c => c.url.includes('events?host_id=eq.'));
  chk('update_team: owner 성공 + events.host_name 동기화', j3.ok === true && j3.team.name === '새이름'
    && JSON.parse(sync.body).host_name === '새이름');
}
// ── 15. create_event: 멤버십·검증
{
  mockFetch([KAPI_OK, MEMBERSHIP(null)]);
  const r = await run({ action: 'create_event', kakao_token: 't', host_id: HOST_ID, event: {} });
  chk('create_event: 비멤버 → 403', r.status === 403 && (await r.json()).error === 'not_member');

  const base = { title: '공연', venue: '게더', starts_at: FUTURE, capacity: 40, price: 15000, max_per_booking: 4 };
  mockFetch([KAPI_OK, MEMBERSHIP('member'),
    [`event_hosts?id=eq.${HOST_ID}`, { body: [{ ...TEAM, bank_info: null }] }]]);
  const r2 = await run({ action: 'create_event', kakao_token: 't', host_id: HOST_ID, event: { ...base, bank_info: '' } });
  chk('create_event: 유료 무계좌 → 400 need_bank', r2.status === 400 && (await r2.json()).error === 'need_bank');

  mockFetch([KAPI_OK, MEMBERSHIP('member'),
    [`event_hosts?id=eq.${HOST_ID}`, { body: [TEAM] }],
    ['events', { method: 'POST', body: [{ id: EV_ID }] }]]);
  const poster = 'https://sb.test/storage/v1/object/public/community-images/events/1.jpg';
  const j3 = await (await run({ action: 'create_event', kakao_token: 't', host_id: HOST_ID,
    event: { ...base, description: '소개', poster_url: poster, venue_address: '서울 마포구', venue_lat: 37.5511, venue_lng: 126.9203 } })).json();
  const ins = JSON.parse(calls.find(c => c.url.endsWith('/events') && c.method === 'POST').body);
  chk('create_event: 공동호스트도 등록 가능 + host_id/host_name/좌표', j3.ok === true && ins.host_id === HOST_ID
    && ins.host_name === '밴드X' && ins.venue_lat === 37.5511 && ins.bank_info === '토스 111');

  mockFetch([KAPI_OK, MEMBERSHIP('owner'), [`event_hosts?id=eq.${HOST_ID}`, { body: [TEAM] }]]);
  const rBad = await run({ action: 'create_event', kakao_token: 't', host_id: HOST_ID, event: { ...base, venue_lat: 999, venue_lng: 126.9 } });
  chk('create_event: 좌표 범위 밖 → 400', rBad.status === 400);
}
// ── 16. update_event: 멤버십 소유권 + ADMIN 백스톱 + 정원 축소
{
  mockFetch([KAPI_OK, ['events?id=eq.', { body: [EVENT_ROW()] }], MEMBERSHIP(null),
    ['event_co_teams?event_id=eq.', { body: [] }]]);
  const r = await run({ action: 'update_event', kakao_token: 't', event_id: EV_ID, patch: { title: 'x' } });
  chk('update_event: 비멤버(공동팀도 아님) → 403', r.status === 403);

  mockFetch([KAPI_ADMIN, ['events?id=eq.', { body: [EVENT_ROW()] }],
    ['events?id=eq.' + EV_ID, { method: 'PATCH', body: [{ id: EV_ID, title: '관리자수정' }] }]]);
  const j2 = await (await run({ action: 'update_event', kakao_token: 't', event_id: EV_ID, patch: { title: '관리자수정' } })).json();
  chk('update_event: ADMIN 백스톱(멤버십 조회 없이) 통과', j2.ok === true);

  mockFetch([KAPI_OK, ['events?id=eq.', { body: [EVENT_ROW()] }], MEMBERSHIP('member'),
    ['status=in.(pending_payment,confirmed)&select=qty', { body: [{ qty: 3 }, { qty: 2 }] }]]);
  const r3 = await run({ action: 'update_event', kakao_token: 't', event_id: EV_ID, patch: { capacity: 3 } });
  chk('update_event: 정원<예매(5석) → 409', r3.status === 409 && (await r3.json()).error === 'capacity_low');
}
// ── 17. my_events: host_id 스코프 + 집계
{
  mockFetch([KAPI_OK, MEMBERSHIP('member'),
    [`events?host_id=eq.${HOST_ID}`, { body: [EVENT_ROW()] }],
    [`event_co_teams?host_id=eq.${HOST_ID}`, { body: [] }],
    ['event_tickets?event_id=in.', { body: [
      { event_id: EV_ID, qty: 2, status: 'confirmed' },
      { event_id: EV_ID, qty: 3, status: 'pending_payment' },
      { event_id: EV_ID, qty: 1, status: 'cancelled' },
    ] }],
    ['event_ticket_seats?select=', { body: [
      { checked_in_at: PAST, event_tickets: { event_id: EV_ID } },
      { checked_in_at: PAST, event_tickets: { event_id: EV_ID } },
    ] }]]);
  const j = await (await run({ action: 'my_events', kakao_token: 't', host_id: HOST_ID })).json();
  const s = j.events[0].stats;
  chk('my_events: 팀 스코프 + 집계(taken 5/확정 2/대기 3/입장은 좌석 기준 2)', j.ok === true
    && s.taken === 5 && s.confirmed === 2 && s.pending === 3 && s.checked_in === 2, JSON.stringify(s));
  mockFetch([KAPI_OK, MEMBERSHIP(null)]);
  const r2 = await run({ action: 'my_events', kakao_token: 't', host_id: HOST_ID });
  chk('my_events: 비멤버 팀 조회 → 403', r2.status === 403);
}
// ── 18. confirm_payment: 멤버십 기반 티켓 소유권
{
  const T = { id: TK_ID, status: 'pending_payment', checked_in_at: null, events: { id: EV_ID, title: 'x', host_id: HOST_ID } };
  mockFetch([KAPI_OK, ['event_tickets?id=eq.' + TK_ID + '&select=', { body: [T] }], MEMBERSHIP('member'),
    ['status=eq.pending_payment', { method: 'PATCH', body: [{ id: TK_ID, status: 'confirmed' }] }]]);
  const j = await (await run({ action: 'confirm_payment', kakao_token: 't', ticket_id: TK_ID })).json();
  chk('confirm_payment: 공동호스트 성공', j.ok === true && j.ticket.status === 'confirmed');
  mockFetch([KAPI_OK, ['event_tickets?id=eq.' + TK_ID + '&select=', { body: [T] }], MEMBERSHIP('member'),
    ['status=eq.pending_payment', { method: 'PATCH', body: [] }]]);
  const r2 = await run({ action: 'confirm_payment', kakao_token: 't', ticket_id: TK_ID });
  chk('confirm_payment: 경합 0행 → 409', r2.status === 409);
}
// ── 19. checkin 상태머신 (좌석 코드 단위 — QR 1장 = 1명)
{
  const seatBody = (tOver = {}, sOver = {}) => [{ code: 'ABCXYZ', seat_no: 1, checked_in_at: null, ...sOver,
    event_tickets: { id: TK_ID, code: 'ABCXYZ', buyer_name: '홍길동', qty: 2, status: 'confirmed', checked_in_at: null,
      events: { id: EV_ID, title: '공연', starts_at: FUTURE, host_id: HOST_ID }, ...tOver } }];
  const seat = (tOver, sOver) => ['event_ticket_seats?code=eq.ABCXYZ&select', { method: 'GET', body: seatBody(tOver, sOver) }];

  mockFetch([KAPI_OK, ['event_ticket_seats?code=eq.QQQQQQ', { body: [] }], ['event_tickets?code=eq.QQQQQQ', { body: [] }]]);
  chk('checkin: 없는 코드 → 404', (await run({ action: 'checkin', kakao_token: 't', code: 'QQQQQQ' })).status === 404);
  mockFetch([KAPI_OK, seat({ status: 'cancelled' }), MEMBERSHIP('member')]);
  chk('checkin: 취소 티켓 → 409 cancelled', (await (await run({ action: 'checkin', kakao_token: 't', code: 'abcxyz' })).json()).error === 'cancelled');
  mockFetch([KAPI_OK, seat({ status: 'pending_payment' }), MEMBERSHIP('member')]);
  const jNC = await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json();
  chk('checkin: 입금 미확인 → 409 + 티켓 id·event_id 동봉', jNC.error === 'not_confirmed' && jNC.ticket.id === TK_ID && jNC.ticket.event_id === EV_ID);
  mockFetch([KAPI_OK, seat({}, { checked_in_at: PAST }), MEMBERSHIP('member')]);
  const jAC = await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json();
  chk('checkin: 좌석 중복 → 409 + 시각', jAC.error === 'already_checked_in' && jAC.checked_in_at === PAST);
  mockFetch([KAPI_OK, seat({}, { cancelled_at: PAST }), MEMBERSHIP('member')]);
  chk('checkin: 부분 취소된 좌석 → 409 cancelled', (await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json()).error === 'cancelled');
  mockFetch([KAPI_OK, seat({}), MEMBERSHIP(null), ['event_co_teams?event_id=eq.', { body: [] }]]);
  chk('checkin: 타 팀 공연 → 403', (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).status === 403);
  mockFetch([KAPI_OK, seat({}), MEMBERSHIP('member'),
    ['event_ticket_seats?code=eq.ABCXYZ&checked_in_at=is.null', { method: 'PATCH', body: [{ code: 'ABCXYZ', checked_in_at: 'now' }] }],
    ['event_tickets?id=eq.' + TK_ID, { method: 'PATCH', body: [] }],
    ['event_ticket_seats?ticket_id=eq.' + TK_ID + '&select=checked_in_at', { method: 'GET', body: [{ checked_in_at: 'now' }, { checked_in_at: null }] }]]);
  const jOK = await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json();
  chk('checkin: 성공 — 좌석 PATCH + 입장 현황(1/2) + 공연명', jOK.ok === true && jOK.ticket.event_title === '공연'
    && jOK.ticket.seat_no === 1 && jOK.ticket.seats_checked === 1 && jOK.ticket.seats_total === 2, JSON.stringify(jOK.ticket));

  // 과거 예매(좌석 미생성) — 티켓 코드로 좌석 만들어 이어감 (1번 좌석 = 예매번호)
  let seeded = false, seededRows = null;
  mockFetch([KAPI_OK,
    ['event_ticket_seats?code=eq.ABCXYZ&select', { method: 'GET', body: () => (seeded ? seatBody() : []) }],
    ['event_tickets?code=eq.ABCXYZ', { method: 'GET', body: [{ id: TK_ID, code: 'ABCXYZ', buyer_name: '홍길동', qty: 2, status: 'confirmed' }] }],
    ['event_ticket_seats?ticket_id=eq.' + TK_ID + '&select=code,seat_no', { method: 'GET',
      body: () => (seeded ? [{ code: 'ABCXYZ', seat_no: 1 }, { code: 'QQ7MNP', seat_no: 2 }] : []) }],
    ['event_ticket_seats', { method: 'POST', body: (rec) => { seeded = true; seededRows = JSON.parse(rec.body); return []; } }],
    MEMBERSHIP('member'),
    ['event_ticket_seats?code=eq.ABCXYZ&checked_in_at=is.null', { method: 'PATCH', body: [{ code: 'ABCXYZ', checked_in_at: 'now' }] }],
    ['event_tickets?id=eq.' + TK_ID, { method: 'PATCH', body: [] }],
    ['event_ticket_seats?ticket_id=eq.' + TK_ID + '&select=checked_in_at', { method: 'GET', body: [{ checked_in_at: 'now' }, { checked_in_at: null }] }]]);
  const jLG = await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json();
  chk('checkin: 좌석 미생성 과거 예매 → 좌석 생성(1번=예매번호) 후 체크인', jLG.ok === true
    && seededRows && seededRows[0].code === 'ABCXYZ' && seededRows[0].seat_no === 1 && seededRows.length === 2, JSON.stringify(seededRows));
}
// ── 19b. uncheckin — 좌석 단위 입장 취소
{
  const seatRow = [{ code: 'ABCXYZ', seat_no: 2, checked_in_at: PAST,
    event_tickets: { id: TK_ID, qty: 2, status: 'confirmed', checked_in_at: PAST,
      events: { id: EV_ID, title: '공연', starts_at: FUTURE, host_id: HOST_ID } } }];
  mockFetch([KAPI_OK, ['event_ticket_seats?code=eq.ABCXYZ&select', { method: 'GET', body: seatRow }], MEMBERSHIP('member'),
    ['event_ticket_seats?code=eq.ABCXYZ&checked_in_at=not.is.null', { method: 'PATCH', body: [{ code: 'ABCXYZ', checked_in_at: null }] }],
    ['event_ticket_seats?ticket_id=eq.' + TK_ID + '&checked_in_at=not.is.null', { method: 'GET', body: [] }],
    ['event_tickets?id=eq.' + TK_ID, { method: 'PATCH', body: [] }]]);
  const j = await (await run({ action: 'uncheckin', kakao_token: 't', code: 'ABCXYZ' })).json();
  const tkPatch = calls.find(c => c.method === 'PATCH' && c.url.includes('event_tickets?id=eq.'));
  chk('uncheckin: 좌석 해제 + 남은 입장 0 → 티켓 표시도 해제', j.ok === true && !!tkPatch
    && JSON.parse(tkPatch.body).checked_in_at === null);
  mockFetch([KAPI_OK, ['event_ticket_seats?code=eq.ABCXYZ&select', { method: 'GET', body: seatRow }], MEMBERSHIP('member'),
    ['event_ticket_seats?code=eq.ABCXYZ&checked_in_at=not.is.null', { method: 'PATCH', body: [] }]]);
  chk('uncheckin: 경합 0행 → 409', (await run({ action: 'uncheckin', kakao_token: 't', code: 'ABCXYZ' })).status === 409);
}
// ── 19c. host_cancel_seat — 부분 입장 후에도 미입장 티켓 취소 (시작 후 가능)
{
  mockFetch([KAPI_OK,
    ['event_ticket_seats?code=eq.KM4TUV&select', { method: 'GET',
      body: [{ code: 'KM4TUV', seat_no: 3, checked_in_at: null, cancelled_at: null,
        event_tickets: { id: TK_ID, qty: 3, status: 'confirmed', checked_in_at: PAST,
          events: { id: EV_ID, title: '공연', starts_at: PAST, host_id: HOST_ID } } }] }],
    MEMBERSHIP('member'),
    ['event_ticket_seats?ticket_id=eq.' + TK_ID + '&select=code,seat_no', { method: 'GET', body: [
      { code: 'ABCXYZ', seat_no: 1, checked_in_at: PAST, cancelled_at: null },
      { code: 'QQ7MNP', seat_no: 2, checked_in_at: null, cancelled_at: null },
      { code: 'KM4TUV', seat_no: 3, checked_in_at: null, cancelled_at: null }] }],
    ['event_ticket_seats?code=eq.KM4TUV&cancelled_at=is.null', { method: 'PATCH', body: [{ code: 'KM4TUV' }] }],
    ['event_tickets?id=eq.' + TK_ID + '&select=qty,status', { method: 'GET', body: [{ qty: 3, status: 'confirmed' }] }],
    ['event_tickets?id=eq.' + TK_ID + '&qty=eq.3', { method: 'PATCH', body: [{ id: TK_ID, qty: 2 }] }],
    ['event_tickets?id=eq.' + TK_ID + '&select=*', { method: 'GET', body: [{ id: TK_ID, qty: 2, status: 'confirmed', checked_in_at: PAST }] }],
  ]);
  const j = await (await run({ action: 'host_cancel_seat', kakao_token: 't', code: 'KM4TUV' })).json();
  chk('host_cancel_seat: 1명 입장 후 미입장 1장 취소 — 공연 시작 후에도 가능', j.ok === true && j.whole === false && j.ticket.qty === 2,
    JSON.stringify(j).slice(0, 100));
  // 입장한 좌석은 호스트도 취소 불가
  mockFetch([KAPI_OK,
    ['event_ticket_seats?code=eq.KM4TUV&select', { method: 'GET',
      body: [{ code: 'KM4TUV', seat_no: 3, checked_in_at: PAST, cancelled_at: null,
        event_tickets: { id: TK_ID, qty: 3, status: 'confirmed', checked_in_at: PAST,
          events: { id: EV_ID, title: '공연', starts_at: PAST, host_id: HOST_ID } } }] }],
    MEMBERSHIP('member')]);
  chk('host_cancel_seat: 입장한 좌석 → 409', (await (await run({ action: 'host_cancel_seat', kakao_token: 't', code: 'KM4TUV' })).json()).error === 'checked_in');
}
// ── 20. 초대: 생성(owner만)·수락·만료
{
  mockFetch([KAPI_OK, MEMBERSHIP('member')]);
  const r = await run({ action: 'create_invite', kakao_token: 't', host_id: HOST_ID });
  chk('create_invite: member → 403 (owner 전용)', r.status === 403);

  mockFetch([KAPI_OK, MEMBERSHIP('owner'),
    [`event_host_invites?host_id=eq.${HOST_ID}`, { method: 'DELETE', body: [] }],
    ['event_host_invites', { method: 'POST', body: [] }]]);
  const j2 = await (await run({ action: 'create_invite', kakao_token: 't', host_id: HOST_ID })).json();
  const del = calls.find(c => c.method === 'DELETE');
  chk('create_invite: 기존 코드 대체 + 6자리 + 7일 만료', j2.ok === true && /^[A-HJ-NP-Z2-9]{6}$/.test(j2.token)
    && !!del && new Date(j2.expires_at) > new Date(Date.now() + 6 * 86400e3));

  mockFetch([KAPI_OK]);
  const r3 = await run({ action: 'accept_invite', kakao_token: 't', token: 'zzz' });
  chk('accept_invite: 형식 오류 → 400 + DB 미조회', r3.status === 400 && calls.length === 1);

  const TOKEN = 'HJKMNP';
  mockFetch([KAPI_OK, [`event_host_invites?token=eq.${TOKEN}`, { body: [] }]]);
  chk('accept_invite: 없는 토큰 → 404', (await run({ action: 'accept_invite', kakao_token: 't', token: TOKEN })).status === 404);

  mockFetch([KAPI_OK, [`event_host_invites?token=eq.${TOKEN}`, { body: [{ token: TOKEN, host_id: HOST_ID, expires_at: PAST, event_hosts: { id: HOST_ID, name: '밴드X' } }] }]]);
  chk('accept_invite: 만료 → 409', (await run({ action: 'accept_invite', kakao_token: 't', token: TOKEN })).status === 409);

  mockFetch([KAPI_OK,
    [`event_host_invites?token=eq.${TOKEN}`, { body: [{ token: TOKEN, host_id: HOST_ID, expires_at: FUTURE, event_hosts: { id: HOST_ID, name: '밴드X' } }] }],
    ['event_host_members?on_conflict=host_id,kakao_id', { method: 'POST', body: [] }]]);
  const j6 = await (await run({ action: 'accept_invite', kakao_token: 't', token: TOKEN })).json();
  const memIns = calls.find(c => c.url.includes('on_conflict=host_id,kakao_id'));
  chk('accept_invite: 성공 — member 멤버십(닉네임) + 팀명 반환', j6.ok === true && j6.team.name === '밴드X'
    && JSON.parse(memIns.body).role === 'member' && JSON.parse(memIns.body).name === '닉네임'
    && memIns.headers.Prefer.includes('ignore-duplicates'));
}
// ── 21. 멤버 관리
{
  mockFetch([KAPI_OK, MEMBERSHIP('member'),
    [`event_host_members?host_id=eq.${HOST_ID}&select=`, { body: [{ kakao_id: '777', name: '닉네임', role: 'owner' }] }]]);
  const j = await (await run({ action: 'list_members', kakao_token: 't', host_id: HOST_ID })).json();
  chk('list_members: 멤버 조회 + my_role/my_kakao_id', j.ok === true && j.members.length === 1 && j.my_role === 'member' && j.my_kakao_id === '777');

  mockFetch([KAPI_OK, MEMBERSHIP('owner'),
    ['role=eq.member', { method: 'DELETE', body: [] }]]);
  const r2 = await run({ action: 'remove_member', kakao_token: 't', host_id: HOST_ID, member_kakao_id: '888' });
  chk('remove_member: owner 대상 → 409 (조건부 DELETE 0행)', r2.status === 409);

  mockFetch([KAPI_OK, MEMBERSHIP('owner'),
    ['role=eq.member', { method: 'DELETE', body: [{ kakao_id: '888' }] }]]);
  const j3 = await (await run({ action: 'remove_member', kakao_token: 't', host_id: HOST_ID, member_kakao_id: '888' })).json();
  chk('remove_member: member 내보내기 성공', j3.ok === true);
}
// ── 22. 공연 공동 관리팀 (연합공연)
{
  const CO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  // 공동 관리팀 멤버가 공연 관리 가능 (주최팀 멤버십 없음 → co-teams 경유)
  mockFetch([KAPI_OK, ['events?id=eq.', { body: [EVENT_ROW()] }], MEMBERSHIP(null),
    ['event_co_teams?event_id=eq.', { body: [{ host_id: CO_ID }] }],
    [`event_host_members?kakao_id=eq.777&host_id=in.(${CO_ID})`, { body: [{ host_id: CO_ID }] }],
    ['events?id=eq.' + EV_ID, { method: 'PATCH', body: [{ id: EV_ID, title: '공동수정' }] }]]);
  const j = await (await run({ action: 'update_event', kakao_token: 't', event_id: EV_ID, patch: { title: '공동수정' } })).json();
  chk('공동 관리팀 멤버: 공연 수정 가능', j.ok === true);

  // create_event_invite — 주최팀 아님(공동팀 소속) → 403
  mockFetch([KAPI_OK, [`events?id=eq.${EV_ID}&select=id,title,host_id`, { body: [{ id: EV_ID, title: '공연', host_id: HOST_ID }] }],
    MEMBERSHIP(null)]);
  const r2 = await run({ action: 'create_event_invite', kakao_token: 't', event_id: EV_ID });
  chk('create_event_invite: 주최팀 아니면 403', r2.status === 403 && (await r2.json()).error === 'not_host_team');

  // create_event_invite 성공 (기존 토큰 대체)
  mockFetch([KAPI_OK, [`events?id=eq.${EV_ID}&select=id,title,host_id`, { body: [{ id: EV_ID, title: '연합공연', host_id: HOST_ID }] }],
    MEMBERSHIP('member'),
    [`event_co_invites?event_id=eq.${EV_ID}`, { method: 'DELETE', body: [] }],
    ['event_co_invites', { method: 'POST', body: [] }]]);
  const j3 = await (await run({ action: 'create_event_invite', kakao_token: 't', event_id: EV_ID })).json();
  chk('create_event_invite: 성공 + 6자리 코드 + 공연명', j3.ok === true && /^[A-HJ-NP-Z2-9]{6}$/.test(j3.token) && j3.event.title === '연합공연');

  // accept_event_invite — 주최팀 자신 → 409 own_team
  const TOKEN = 'QRSTUV';
  const INV = (hostId) => [`event_co_invites?token=eq.${TOKEN}`, { body: [{ token: TOKEN, expires_at: FUTURE, events: { id: EV_ID, title: '연합공연', host_id: hostId } }] }];
  mockFetch([KAPI_OK, MEMBERSHIP('owner'), INV(HOST_ID)]);
  const r4 = await run({ action: 'accept_event_invite', kakao_token: 't', token: TOKEN, host_id: HOST_ID });
  chk('accept_event_invite: 주최팀 자신 → 409', r4.status === 409 && (await r4.json()).error === 'own_team');

  // accept_event_invite — 팀 owner가 수락 성공
  mockFetch([KAPI_OK, MEMBERSHIP('owner'), INV(CO_ID),
    ['event_co_teams?on_conflict=event_id,host_id', { method: 'POST', body: [] }]]);
  const j5 = await (await run({ action: 'accept_event_invite', kakao_token: 't', token: TOKEN, host_id: HOST_ID })).json();
  const ins = calls.find(c => c.url.includes('event_co_teams?on_conflict'));
  chk('accept_event_invite: 성공 — 팀 단위 합류(ignore-duplicates)', j5.ok === true && j5.event.title === '연합공연'
    && JSON.parse(ins.body).host_id === HOST_ID && ins.headers.Prefer.includes('ignore-duplicates'));

  // accept — member는 403 (팀 소유자만 팀을 대표해 수락)
  mockFetch([KAPI_OK, MEMBERSHIP('member')]);
  chk('accept_event_invite: 팀 member → 403', (await run({ action: 'accept_event_invite', kakao_token: 't', token: TOKEN, host_id: HOST_ID })).status === 403);

  // remove_co_team — 참여팀 수정은 주최팀만 (공동팀 owner의 자진 탈퇴도 불가)
  mockFetch([KAPI_OK, [`events?id=eq.${EV_ID}&select=id,host_id`, { body: [{ id: EV_ID, host_id: CO_ID }] }],
    [`event_host_members?host_id=eq.${CO_ID}&kakao_id=eq.777`, { body: [] }]]);      // 주최팀(CO_ID) 멤버 아님
  const r7 = await run({ action: 'remove_co_team', kakao_token: 't', event_id: EV_ID, host_id: HOST_ID });
  chk('remove_co_team: 주최팀 아니면(공동팀 owner 포함) 403', r7.status === 403 && (await r7.json()).error === 'not_host_team');
  mockFetch([KAPI_OK, [`events?id=eq.${EV_ID}&select=id,host_id`, { body: [{ id: EV_ID, host_id: HOST_ID }] }],
    MEMBERSHIP('member'),
    ['event_co_teams?event_id=eq.', { method: 'DELETE', body: [{ host_id: CO_ID }] }]]);
  const j7 = await (await run({ action: 'remove_co_team', kakao_token: 't', event_id: EV_ID, host_id: CO_ID })).json();
  chk('remove_co_team: 주최팀 멤버는 성공', j7.ok === true);

  // attendees에 co_teams + is_host_team + 티켓별 좌석 첨부
  mockFetch([KAPI_OK, ['events?id=eq.', { body: [EVENT_ROW()] }], MEMBERSHIP('member'),
    ['event_tickets?event_id=eq.', { body: [{ id: TK_ID, qty: 2, status: 'confirmed', checked_in_at: null }] }],
    ['event_ticket_seats?ticket_id=in.', { body: [
      { ticket_id: TK_ID, code: 'ABCXYZ', seat_no: 1, checked_in_at: PAST },
      { ticket_id: TK_ID, code: 'QQ7MNP', seat_no: 2, checked_in_at: null }] }],
    ['event_co_teams?event_id=eq.', { body: [{ host_id: CO_ID, event_hosts: { id: CO_ID, name: '어쿠스틱 팀', logo_url: null } }] }]]);
  const j8 = await (await run({ action: 'attendees', kakao_token: 't', event_id: EV_ID })).json();
  chk('attendees: co_teams + 티켓별 좌석(입장 1/2) 첨부', j8.ok === true && j8.co_teams[0].name === '어쿠스틱 팀'
    && j8.is_host_team === true && j8.tickets[0].seats.length === 2 && j8.tickets[0].seats[0].checked_in_at === PAST,
    JSON.stringify(j8.tickets && j8.tickets[0] && j8.tickets[0].seats));
}
// ── 23. my_events: 공동 관리 공연 병합
{
  const CO_EV = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  mockFetch([KAPI_OK, MEMBERSHIP('member'),
    [`events?host_id=eq.${HOST_ID}`, { body: [EVENT_ROW()] }],
    [`event_co_teams?host_id=eq.${HOST_ID}`, { body: [{ event_id: CO_EV }] }],
    [`events?id=in.(${CO_EV})`, { body: [EVENT_ROW({ id: CO_EV, title: '연합공연', host_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', host_name: '주최팀B' })] }],
    ['event_tickets?event_id=in.', { body: [] }],
    ['event_ticket_seats?select=', { body: [] }]]);
  const j = await (await run({ action: 'my_events', kakao_token: 't', host_id: HOST_ID })).json();
  const co = j.events.find(e => e.id === CO_EV);
  chk('my_events: 공동 관리 공연 병합 + co_hosted 플래그', j.ok === true && j.events.length === 2 && co && co.co_hosted === true && co.host_name === '주최팀B');
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
