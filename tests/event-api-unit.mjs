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

// ═══════════ Phase B: 호스트 액션 ═══════════
const HOST = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kakao_id: '777', name: '밴드X', contact_phone: '01011112222', bank_info: '토스 111' };
const KAPI_OK = ['kapi.kakao.com', { body: { id: 777 } }];
const KAPI_ADMIN = ['kapi.kakao.com', { body: { id: 4883868250 } }];
const EVENT_ROW = (over = {}) => ({ id: EV_ID, host_id: HOST.id, host_name: '밴드X', title: '공연', venue: '게더',
  starts_at: FUTURE, capacity: 40, price: 15000, bank_info: '토스 111', max_per_booking: 4, status: 'published',
  event_hosts: { kakao_id: '777' }, ...over });

// ── 12. 토큰 무효 → 401
{
  mockFetch([['kapi.kakao.com', { status: 401, body: { code: -401 } }]]);
  const r = await run({ action: 'my_events', kakao_token: 'expired' });
  chk('호스트: 카카오 토큰 무효 → 401', r.status === 401 && (await r.json()).error === 'auth');
  mockFetch([]);
  const r2 = await run({ action: 'my_events' });
  chk('호스트: 토큰 없음 → 401 + kapi 미호출', r2.status === 401 && calls.length === 0);
}
// ── 13. host_me / register_host
{
  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [] }]]);
  const j = await (await run({ action: 'host_me', kakao_token: 't' })).json();
  chk('host_me: 미등록 → host null', j.ok === true && j.host === null && j.is_admin === false);
  mockFetch([KAPI_OK, ['event_hosts?on_conflict=kakao_id', { method: 'POST', body: [HOST] }],
    [`events?host_id=eq.${HOST.id}`, { method: 'PATCH', body: [] }]]);
  const j2 = await (await run({ action: 'register_host', kakao_token: 't', name: ' 밴드X ', bio: ' 신촌 5인조 밴드 ', sns: 'instagram.com/bandx' })).json();
  const post = calls.find(c => c.url.includes('on_conflict'));
  const nameSync = calls.find(c => c.url.includes('events?host_id=eq.') && c.method === 'PATCH');
  chk('register_host: upsert(팀 소개·SNS) + 정규화', j2.ok === true && post.headers.Prefer.includes('merge-duplicates')
    && JSON.parse(post.body).name === '밴드X' && JSON.parse(post.body).bio === '신촌 5인조 밴드' && JSON.parse(post.body).sns === 'instagram.com/bandx');
  chk('register_host: events.host_name 동기화 PATCH', !!nameSync && JSON.parse(nameSync.body).host_name === '밴드X');
  mockFetch([KAPI_OK]);
  const r3 = await run({ action: 'register_host', kakao_token: 't', name: '' });
  chk('register_host: 이름 없음 → 400', r3.status === 400);
}
// ── 14. create_event 검증
{
  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [] }]]);
  const r = await run({ action: 'create_event', kakao_token: 't', event: {} });
  chk('create_event: 호스트 미등록 → 403', r.status === 403 && (await r.json()).error === 'no_host');

  const base = { title: '공연', venue: '게더', starts_at: FUTURE, capacity: 40, price: 15000, max_per_booking: 4 };
  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [{ ...HOST, bank_info: null }] }]]);
  const r2 = await run({ action: 'create_event', kakao_token: 't', event: { ...base, bank_info: '' } });
  chk('create_event: 유료 무계좌 → 400 need_bank', r2.status === 400 && (await r2.json()).error === 'need_bank');

  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [HOST] }]]);
  const r3 = await run({ action: 'create_event', kakao_token: 't', event: { ...base, poster_url: 'https://evil.example/x.png' } });
  chk('create_event: 포스터 외부 URL → 400', r3.status === 400 && (await r3.json()).error === 'bad_poster');

  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [HOST] }]]);
  const r4 = await run({ action: 'create_event', kakao_token: 't', event: { ...base, starts_at: PAST } });
  chk('create_event: 과거 일시 → 400', r4.status === 400);

  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [HOST] }],
    ['events', { method: 'POST', body: [{ id: EV_ID }] }]]);
  const poster = 'https://sb.test/storage/v1/object/public/community-images/events/1.jpg';
  const j5 = await (await run({ action: 'create_event', kakao_token: 't', event: { ...base, description: '소개', poster_url: poster,
    venue_address: '서울 마포구 와우산로 12', venue_lat: 37.5511, venue_lng: 126.9203 } })).json();
  const ins = JSON.parse(calls.find(c => c.url.endsWith('/events') && c.method === 'POST').body);
  chk('create_event: 성공 + host_id/host_name/계좌 폴백', j5.ok === true && ins.host_id === HOST.id && ins.host_name === '밴드X'
    && ins.bank_info === '토스 111' && ins.poster_url === poster);
  chk('create_event: 장소 좌표·주소 저장', ins.venue_address === '서울 마포구 와우산로 12' && ins.venue_lat === 37.5511 && ins.venue_lng === 126.9203);

  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [HOST] }]]);
  const rBad = await run({ action: 'create_event', kakao_token: 't', event: { ...base, venue_lat: 999, venue_lng: 126.9 } });
  chk('create_event: 좌표 범위 밖 → 400', rBad.status === 400);
}
// ── 15. update_event 소유권·정원 축소
{
  mockFetch([KAPI_OK, ['events?id=eq.', { body: [EVENT_ROW({ event_hosts: { kakao_id: '888' } })] }]]);
  const r = await run({ action: 'update_event', kakao_token: 't', event_id: EV_ID, patch: { title: 'x' } });
  chk('update_event: 타인 공연 → 403', r.status === 403);

  mockFetch([KAPI_ADMIN, ['events?id=eq.', { body: [EVENT_ROW({ event_hosts: { kakao_id: '888' } })] }],
    ['events?id=eq.' + EV_ID, { method: 'PATCH', body: [{ id: EV_ID, title: '관리자수정' }] }]]);
  const j2 = await (await run({ action: 'update_event', kakao_token: 't', event_id: EV_ID, patch: { title: '관리자수정' } })).json();
  chk('update_event: ADMIN 백스톱 통과', j2.ok === true);

  mockFetch([KAPI_OK, ['events?id=eq.', { body: [EVENT_ROW()] }],
    ['status=in.(pending_payment,confirmed)&select=qty', { body: [{ qty: 3 }, { qty: 2 }] }]]);
  const r3 = await run({ action: 'update_event', kakao_token: 't', event_id: EV_ID, patch: { capacity: 3 } });
  chk('update_event: 정원<예매(5석) → 409', r3.status === 409 && (await r3.json()).error === 'capacity_low');
}
// ── 16. my_events 집계
{
  mockFetch([KAPI_OK, ['event_hosts?kakao_id=eq.777', { body: [HOST] }],
    [`events?host_id=eq.${HOST.id}`, { body: [EVENT_ROW()] }],
    ['event_tickets?event_id=in.', { body: [
      { event_id: EV_ID, qty: 2, status: 'confirmed', checked_in_at: PAST },
      { event_id: EV_ID, qty: 3, status: 'pending_payment', checked_in_at: null },
      { event_id: EV_ID, qty: 1, status: 'cancelled', checked_in_at: null },
    ] }]]);
  const j = await (await run({ action: 'my_events', kakao_token: 't' })).json();
  const s = j.events[0].stats;
  chk('my_events: 집계(취소 제외, taken 5/확정 2/대기 3/입장 2)', j.ok === true
    && s.taken === 5 && s.confirmed === 2 && s.pending === 3 && s.checked_in === 2, JSON.stringify(s));
}
// ── 17. confirm_payment 조건부 PATCH
{
  const T = { id: TK_ID, status: 'pending_payment', checked_in_at: null, events: { id: EV_ID, title: 'x', event_hosts: { kakao_id: '777' } } };
  mockFetch([KAPI_OK, ['event_tickets?id=eq.' + TK_ID + '&select=', { body: [T] }],
    ['status=eq.pending_payment', { method: 'PATCH', body: [{ id: TK_ID, status: 'confirmed' }] }]]);
  const j = await (await run({ action: 'confirm_payment', kakao_token: 't', ticket_id: TK_ID })).json();
  chk('confirm_payment: 성공', j.ok === true && j.ticket.status === 'confirmed');
  mockFetch([KAPI_OK, ['event_tickets?id=eq.' + TK_ID + '&select=', { body: [T] }],
    ['status=eq.pending_payment', { method: 'PATCH', body: [] }]]);
  const r2 = await run({ action: 'confirm_payment', kakao_token: 't', ticket_id: TK_ID });
  chk('confirm_payment: 경합 0행 → 409', r2.status === 409);
}
// ── 18. checkin 상태머신
{
  const tk = (over) => [`event_tickets?code=eq.ABCXYZ`, { body: [{ id: TK_ID, code: 'ABCXYZ', buyer_name: '홍길동', qty: 2,
    status: 'confirmed', checked_in_at: null, events: { id: EV_ID, title: '공연', starts_at: FUTURE, event_hosts: { kakao_id: '777' } }, ...over }] }];
  mockFetch([KAPI_OK, ['event_tickets?code=eq.QQQQQQ', { body: [] }]]);
  chk('checkin: 없는 코드 → 404', (await run({ action: 'checkin', kakao_token: 't', code: 'QQQQQQ' })).status === 404);
  mockFetch([KAPI_OK, tk({ status: 'cancelled' })]);
  chk('checkin: 취소 티켓 → 409 cancelled', (await (await run({ action: 'checkin', kakao_token: 't', code: 'abcxyz' })).json()).error === 'cancelled');
  mockFetch([KAPI_OK, tk({ status: 'pending_payment' })]);
  const jNC = await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json();
  chk('checkin: 입금 미확인 → 409 + 티켓 id 동봉', jNC.error === 'not_confirmed' && jNC.ticket.id === TK_ID);
  mockFetch([KAPI_OK, tk({ checked_in_at: PAST })]);
  const jAC = await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json();
  chk('checkin: 중복 → 409 + 시각', jAC.error === 'already_checked_in' && jAC.checked_in_at === PAST);
  mockFetch([KAPI_OK, tk({ events: { id: EV_ID, title: 'x', starts_at: FUTURE, event_hosts: { kakao_id: '999' } } })]);
  chk('checkin: 타 호스트 공연 → 403', (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).status === 403);
  mockFetch([KAPI_OK, tk({}),
    ['status=eq.confirmed&checked_in_at=is.null', { method: 'PATCH', body: [{ id: TK_ID, checked_in_at: 'now' }] }]]);
  const jOK = await (await run({ action: 'checkin', kakao_token: 't', code: 'ABCXYZ' })).json();
  chk('checkin: 성공 + 이름·매수·공연명', jOK.ok === true && jOK.ticket.event_title === '공연');
}
// ── 19. uncheckin
{
  const T = { id: TK_ID, status: 'confirmed', checked_in_at: PAST, events: { id: EV_ID, title: 'x', event_hosts: { kakao_id: '777' } } };
  mockFetch([KAPI_OK, ['event_tickets?id=eq.' + TK_ID + '&select=', { body: [T] }],
    ['checked_in_at=not.is.null', { method: 'PATCH', body: [{ id: TK_ID, checked_in_at: null }] }]]);
  const j = await (await run({ action: 'uncheckin', kakao_token: 't', ticket_id: TK_ID })).json();
  chk('uncheckin: 성공', j.ok === true && j.ticket.checked_in_at === null);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
