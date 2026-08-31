// /send-reminders Cloudflare 함수 단위 테스트 — fetch 목으로 시나리오 검증
// 실행: node tests/send-reminders-unit.mjs
import { onRequest } from '../functions/send-reminders.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service' };
const BK_ID = '11111111-1111-4111-8111-111111111111';

const req = (method = 'POST') =>
  new Request('https://gatherallaround.co.kr/send-reminders', {
    method, headers: { Origin: 'https://gatherallaround.co.kr' },
  });
const run = (method = 'POST', env = ENV) => onRequest({ request: req(method), env });

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { url: String(url), method: opts.method || 'GET', body: opts.body };
    calls.push(rec);
    for (const [pat, resp] of routes) {
      if (rec.url.includes(pat) && (!resp.method || resp.method === rec.method)) {
        return new Response(JSON.stringify(typeof resp.body === 'function' ? resp.body(rec) : (resp.body ?? {})), { status: resp.status ?? 200 });
      }
    }
    throw new Error('unexpected fetch: ' + rec.method + ' ' + rec.url);
  };
}

// 함수와 동일한 KST 날짜 계산
const kst = (off = 0) => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const BK = (over = {}) => ({
  id: BK_ID, name: '홍길동', status: 'approved', date: kst(2), start_time: '18:00', end_time: '22:00',
  headcount: 5, booking_code: 'AB23CD', reminder_sent_at: null, ...over,
});
const notifyPayload = () => {
  const c = calls.find(c => c.url.includes('/notify-admins'));
  return c ? JSON.parse(c.body) : null;
};

// ── 1. GET 드라이런 — 선점·발송 없음
{
  mockFetch([['performance_bookings?status=eq.approved', { body: [BK()] }]]);
  const j = await (await run('GET')).json();
  chk('GET 드라이런: 대상 요약만, PATCH·푸시 없음',
    j['발송_대기'] === 1 && j['오늘_KST'] === kst(0)
    && !calls.some(c => c.method === 'PATCH') && !calls.some(c => c.url.includes('/notify-admins')),
    JSON.stringify(j).slice(0, 100));
}
// ── 2. D-2 승인 예약 → 선점 후 관리자 푸시
{
  mockFetch([
    ['performance_bookings?status=eq.approved', { body: [BK()] }],
    ['reminder_sent_at=is.null', { method: 'PATCH', body: [BK()] }],
    ['/notify-admins', { method: 'POST', body: { ok: true } }],
  ]);
  const j = await (await run()).json();
  const p = notifyPayload();
  const [, m, d] = kst(2).split('-').map(Number);
  chk('D-2 발송: ok + sent 1', j.ok === true && j.sent === 1 && j.checked === 1);
  chk('제목: D-2 표기', !!p && p.title === '⏰ 공간 대관 D-2', p && p.title);
  chk('본문: 이름·일시·인원·예약번호', !!p && p.body.includes('홍길동') && p.body.includes(`${m}/${d}(`)
    && p.body.includes('18-23시') && p.body.includes('5명') && p.body.includes('AB23CD'), p && p.body);
  chk('선점 PATCH가 푸시보다 먼저', calls.findIndex(c => c.method === 'PATCH') < calls.findIndex(c => c.url.includes('/notify-admins')));
}
// ── 3. 당일(캐치업) 건 → D-DAY 표기
{
  mockFetch([
    ['performance_bookings?status=eq.approved', { body: [BK({ date: kst(0) })] }],
    ['reminder_sent_at=is.null', { method: 'PATCH', body: [BK()] }],
    ['/notify-admins', { method: 'POST', body: { ok: true } }],
  ]);
  await (await run()).json();
  const p = notifyPayload();
  chk('놓친 건 캐치업: D-DAY 표기', !!p && p.title === '⏰ 공간 대관 D-DAY', p && p.title);
}
// ── 4. 선점 경합 — 이미 처리된 건은 푸시 없음
{
  mockFetch([
    ['performance_bookings?status=eq.approved', { body: [BK()] }],
    ['reminder_sent_at=is.null', { method: 'PATCH', body: [] }],
  ]);
  const j = await (await run()).json();
  chk('선점 실패(빈 배열) → 푸시 없음, sent 0', j.ok === true && j.sent === 0
    && !calls.some(c => c.url.includes('/notify-admins')));
}
// ── 5. 대상 없음 / 조회 실패
{
  mockFetch([['performance_bookings?status=eq.approved', { body: [] }]]);
  const j = await (await run()).json();
  chk('대상 없음: checked 0 sent 0', j.ok === true && j.checked === 0 && j.sent === 0);

  mockFetch([['performance_bookings?status=eq.approved', { status: 500, body: { msg: 'boom' } }]]);
  const r = await run();
  chk('조회 실패 → 502', r.status === 502);
}
// ── 6. 조회 쿼리 조건 — 승인·미발송·오늘~이틀 뒤(KST)
{
  mockFetch([['performance_bookings?status=eq.approved', { body: [] }]]);
  await run();
  const q = calls[0].url;
  chk('쿼리: 승인 + 미발송 + 날짜 창', q.includes('status=eq.approved') && q.includes('reminder_sent_at=is.null')
    && q.includes(`date=gte.${kst(0)}`) && q.includes(`date=lte.${kst(2)}`), q.slice(q.indexOf('?'), q.indexOf('?') + 120));
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
