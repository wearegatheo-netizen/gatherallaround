// /send-reminders Cloudflare 함수 단위 테스트 — fetch 목으로 시나리오 검증
// 실행: node tests/send-reminders-unit.mjs
import { onRequest, bandCycleStart, bandCycleEnd, bandCycleDue, bandInferCycle, bandNextCycle } from '../functions/send-reminders.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service' };
const BK_ID = '11111111-1111-4111-8111-111111111111';

const req = (method = 'POST') =>
  new Request('https://gatherallaround.com/send-reminders', {
    method, headers: { Origin: 'https://gatherallaround.com' },
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

// 시각 고정(월 중순) — 실행일이 1일이어도 파기 로직이 일반 테스트에 끼어들지 않게
Date.now = () => Date.parse('2026-09-15T10:00:00+09:00');

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
  chk('수신자: 운영 총괄만', !!p && JSON.stringify(p.roles) === '["운영 총괄"]', p && JSON.stringify(p.roles));
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

// ── 7. 매월 1일: 보유기간(1년) 만료 건 파기
{
  Date.now = () => Date.parse('2026-10-01T08:00:00+09:00'); // 1일로 이동
  mockFetch([
    ['performance_bookings?status=eq.approved', { body: [] }],
    ['performance_bookings?date=lt.', { method: 'DELETE', body: [{ id: 'a' }, { id: 'b' }] }],
  ]);
  const j = await (await run()).json();
  const del = calls.find(c => c.method === 'DELETE');
  chk('1일 POST: 파기 DELETE 실행 + purged 2', j.ok === true && j.purged === 2 && !!del, JSON.stringify(j));
  const cutoffTs = new Date(Date.now() - 365 * 86400e3).toISOString(); // 정확히 365일 전 시각
  chk('파기 조건: 이용일·접수일 모두 1년 경과', !!del && del.url.includes('date=lt.2025-10-01') && del.url.includes(`created_at=lt.${cutoffTs}`),
    del && del.url.slice(del.url.indexOf('?')));

  mockFetch([['performance_bookings?status=eq.approved', { body: [] }]]);
  await run('GET');
  chk('1일 GET(드라이런): 파기 안 함', !calls.some(c => c.method === 'DELETE'));

  Date.now = () => Date.parse('2026-10-02T08:00:00+09:00'); // 1일 아님
  mockFetch([['performance_bookings?status=eq.approved', { body: [] }]]);
  const j2 = await (await run()).json();
  chk('1일 아니면 파기 안 함 (purged 0)', j2.purged === 0 && !calls.some(c => c.method === 'DELETE'));
}


// ═══════════ 고정 합주팀 회차 사용료 입금 안내 문자 ═══════════
const ENV_SMS = { ...ENV, SOLAPI_API_KEY: 'sol-key', SOLAPI_API_SECRET: 'sol-secret', SMS_SENDER: '010-5109-1042' };
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
// 아나하: 화·수 야간, 시작 2026-09-15(화) → 1차 시작 10/13, 입금일 09/29(시작 2주 전 = 3주차 사용일), 등록 종료일 10/06
const TEAM = (over = {}) => ({
  id: TEAM_ID, name: '신선진', band_name_kr: '아나하', leader_phone: '010-6787-1995', phone: null,
  band_start_date: '2026-09-15', band_fee: 300000, instruments: 'anaha', email: 'anaha@band.gatheo.kr', ...over,
});
const at = (ymd) => { Date.now = () => Date.parse(`${ymd}T08:00:00+09:00`); };
const bandRoutes = ({ teams = [TEAM()], payments = [], reminders = [], claim = { status: 201 }, solapi = { status: 200 } } = {}) => [
  ['performance_bookings?status=eq.approved', { body: [] }],
  ['profiles?member_type=eq.band', { body: teams }],
  ['band_payments?team_id=in.', { body: payments }],
  ['band_rent_reminders?team_id=in.', { body: reminders }],
  ['band_rent_reminders?team_id=eq.', { method: 'DELETE', body: [] }],
  ['rest/v1/band_rent_reminders', { method: 'POST', status: claim.status, body: claim.body ?? [{}] }],
  ['api.solapi.com/messages', { method: 'POST', status: solapi.status, body: {} }],
  ['/notify-admins', { method: 'POST', body: { ok: true } }],
];
const solapiMsg = () => { const c = calls.find(c => c.url.includes('api.solapi.com/messages')); return c ? JSON.parse(c.body).message : null; };
const claimBody = () => { const c = calls.find(c => c.method === 'POST' && /rest\/v1\/band_rent_reminders$/.test(c.url)); return c ? JSON.parse(c.body) : null; };

// ── B0. 회차 수식 — 내부운영 시트 값과 일치
{
  chk('벤더 05/17 → 1~4차 시작일', ['2026-06-14', '2026-07-12', '2026-08-09', '2026-09-06'].every((d, i) => bandCycleStart('2026-05-17', i + 1) === d));
  chk('벤더 등록 회차 종료일 06/07', bandCycleEnd('2026-05-17', 0) === '2026-06-07');
  chk('아나하 09/15 → 1차 입금일 09/29 = 시작일 + 14(3주차 사용일) · 등록 종료일 10/06', bandCycleDue('2026-09-15', 1) === '2026-09-29' && bandCycleEnd('2026-09-15', 0) === '2026-10-06');
  chk('벤더 05/17 → 1차 입금일 05/31 (다음 시작 06/14 의 2주 전)', bandCycleDue('2026-05-17', 1) === '2026-05-31');
  chk('등록(0차) 입금일 = 시작일', bandCycleDue('2026-05-17', 0) === '2026-05-17');
  chk('구형 납부 귀속(창 [시작−21, 시작+7)): 05/17→등록, 06/08→1차, 07/07→2차, 08/07→3차, 08/30→4차, 늦은 06/20→1차, 이른 05/31→1차, 등록 늦은 05/23→등록',
    [['2026-05-17', 0], ['2026-06-08', 1], ['2026-07-07', 2], ['2026-08-07', 3], ['2026-08-30', 4], ['2026-06-20', 1], ['2026-05-31', 1], ['2026-05-23', 0]].every(([d, n]) => bandInferCycle('2026-05-17', d) === n));
  chk('다음 회차: 시작 전 0, 시작일 1, 27일째 1, 28일째 2', bandNextCycle('2026-09-15', '2026-09-01') === 0
    && bandNextCycle('2026-09-15', '2026-09-15') === 1 && bandNextCycle('2026-09-15', '2026-10-12') === 1 && bandNextCycle('2026-09-15', '2026-10-13') === 2);
}
// ── B1. 입금일 당일·미납 → 선점 후 문자 + 관리자 푸시
{
  at('2026-09-29');
  mockFetch(bandRoutes());
  const j = await (await run('POST', ENV_SMS)).json();
  const msg = solapiMsg();
  const cb = claimBody();
  chk('입금일 발송: band_checked 1 · band_sent 1', j.ok === true && j.band_checked === 1 && j.band_sent === 1, JSON.stringify(j));
  chk('선점 행: team·1차·due', !!cb && cb.team_id === TEAM_ID && cb.cycle_no === 1 && cb.kind === 'due' && !!cb.sent_at);
  chk('선점 POST 가 솔라피보다 먼저', calls.findIndex(c => /band_rent_reminders$/.test(c.url)) < calls.findIndex(c => c.url.includes('api.solapi.com')));
  chk('수신·발신 번호 숫자만', !!msg && msg.to === '01067871995' && msg.from === '01051091042');
  chk('본문: 팀명·다음 회차·오늘 입금일', !!msg && msg.text.includes('[아나하] 팀 고정 합주 다음 회차(10/13(화)부터 4주) 사용료 입금일이 오늘(9/29)입니다.'), (msg?.text || '').slice(0, 120));
  chk('본문: 사용료 금액·계좌', !!msg && msg.text.includes('사용료(300,000원)를') && msg.text.includes('토스뱅크 1000-2274-7678 최경수'));
  chk('본문: 이모지 없음(EUC-KR 안전)', !!msg && !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(msg.text));
  chk('LMS 제목 지정', !!msg && msg.subject === '게더 올 어라운드 사용료 안내');
  const p = notifyPayload();
  chk('관리자 푸시: 팀·회차·입금일, 운영 총괄만', !!p && p.title.includes('월세') && p.body.includes('아나하') && p.body.includes('1차') && p.body.includes('9/29')
    && JSON.stringify(p.roles) === '["운영 총괄"]', p && p.body);
}
// ── B2. 해당 회차 납부 기록 있으면 발송 없음 (cycle_no 명시 / 구형 행 귀속)
{
  at('2026-09-29');
  mockFetch(bandRoutes({ payments: [{ team_id: TEAM_ID, paid_at: '2026-10-01', cycle_no: 1 }] }));
  const j = await (await run('POST', ENV_SMS)).json();
  chk('cycle_no=1 납부 → 대상 아님', j.band_checked === 0 && !calls.some(c => c.url.includes('api.solapi.com')));
  mockFetch(bandRoutes({ payments: [{ team_id: TEAM_ID, paid_at: '2026-09-28', cycle_no: null }] }));
  const j2 = await (await run('POST', ENV_SMS)).json();
  chk('구형 행(09/28, cycle_no 없음) → 1차 납부 창(09/22~10/19)이라 1차로 귀속되어 대상 아님', j2.band_checked === 0);
  mockFetch(bandRoutes({ payments: [{ team_id: TEAM_ID, paid_at: '2026-09-15', cycle_no: null }] }));
  const j3 = await (await run('POST', ENV_SMS)).json();
  chk('등록(0차) 납부만 있으면 1차는 미납 → 대상', j3.band_checked === 1);
}
// ── B3. 입금일 전 / 시작일 이후는 대상 아님
{
  at('2026-09-28');
  mockFetch(bandRoutes());
  const j = await (await run('POST', ENV_SMS)).json();
  chk('입금일 전날(09/28): 대상 아님', j.band_checked === 0);
  at('2026-10-13');
  mockFetch(bandRoutes({ reminders: [{ team_id: TEAM_ID, cycle_no: 1, kind: 'due' }] }));
  const j2 = await (await run('POST', ENV_SMS)).json();
  chk('시작일 당일(10/13): 2차는 아직 입금일 전 → 대상 아님', j2.band_checked === 0);
}
// ── B4. 캐치업 — 입금일 지난 뒤 처음 실행되면 "지났습니다" 문구로 1건
{
  at('2026-10-09');
  mockFetch(bandRoutes());
  const j = await (await run('POST', ENV_SMS)).json();
  const msg = solapiMsg();
  chk('캐치업 발송 1건 (kind due)', j.band_sent === 1 && claimBody().kind === 'due');
  chk('본문: 입금일 지남 문구', !!msg && msg.text.includes('사용료 입금일(9/29)이 지났습니다. 아직 입금 확인이 되지 않아 안내드립니다.'), (msg?.text || '').slice(0, 120));
}
// ── B5. 회차당 최대 3회: due(3주차) → week4(시작 1주 전) → last(시작 전날)
{
  const R = (...kinds) => kinds.map(k => ({ team_id: TEAM_ID, cycle_no: 1, kind: k }));
  at('2026-10-06'); // 시작(10/13) 1주 전 = 4주차 첫 사용일
  mockFetch(bandRoutes({ reminders: R('due') }));
  const j = await (await run('POST', ENV_SMS)).json();
  const msg = solapiMsg();
  chk('4주차(시작 1주 전): due 발송됐고 미납 → kind week4', j.band_sent === 1 && claimBody().kind === 'week4');
  chk('본문: 시작 일주일 남음 문구', !!msg && msg.text.includes('다음 회차(10/13(화)부터 4주) 시작이 일주일 남았습니다. 아직 입금 확인이 되지 않아 안내드립니다.'), (msg?.text || '').slice(0, 120));
  at('2026-10-03');
  mockFetch(bandRoutes({ reminders: R('due') }));
  chk('시작 1주 전보다 이르면(10/03) week4 아직 아님', (await (await run('POST', ENV_SMS)).json()).band_checked === 0);
  at('2026-10-09');
  mockFetch(bandRoutes({ reminders: R('due') }));
  chk('week4 캐치업(10/09, 크론 빠짐) → week4 1건', (await (await run('POST', ENV_SMS)).json()).band_sent === 1 && claimBody().kind === 'week4');
  at('2026-10-12'); // 시작 전날
  mockFetch(bandRoutes({ reminders: R('due', 'week4') }));
  const j4 = await (await run('POST', ENV_SMS)).json();
  const msg4 = solapiMsg();
  chk('시작 전날: due·week4 발송됐고 미납 → kind last', j4.band_sent === 1 && claimBody().kind === 'last');
  chk('본문: 내일 시작 문구', !!msg4 && msg4.text.includes('다음 회차(10/13(화)부터 4주)가 내일 시작됩니다. 아직 입금 확인이 되지 않아 안내드립니다.'), (msg4?.text || '').slice(0, 120));
  mockFetch(bandRoutes({ reminders: R('due', 'week4', 'last') }));
  chk('3회 모두 발송됨 → 대상 아님', (await (await run('POST', ENV_SMS)).json()).band_checked === 0);
  mockFetch(bandRoutes({ reminders: R('due') }));
  chk('전날인데 week4 미발송이면 week4 먼저(하루 1건)', (await (await run('POST', ENV_SMS)).json()).band_sent === 1 && claimBody().kind === 'week4');
  at('2026-10-10');
  mockFetch(bandRoutes({ reminders: R('due', 'week4') }));
  chk('due·week4 발송 후 전날이 아니면 발송 없음', (await (await run('POST', ENV_SMS)).json()).band_checked === 0);
  // 납부 완료면 어떤 단계든 발송 없음
  at('2026-10-12');
  mockFetch(bandRoutes({ reminders: R('due', 'week4'), payments: [{ team_id: TEAM_ID, paid_at: '2026-10-11', cycle_no: 1 }] }));
  chk('납부 완료 후엔 last 도 발송 없음', (await (await run('POST', ENV_SMS)).json()).band_checked === 0);
}
// ── B5-2. scope — 08:00 크론(booking) 은 문자 없음, 12:00 크론(band) 은 대관 푸시·파기 없음
{
  at('2026-09-29');
  const runScope = (scope) => onRequest({ request: new Request('https://gatherallaround.com/send-reminders', { method: 'POST', headers: { Origin: 'https://gatherallaround.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) }), env: ENV_SMS });
  mockFetch([['performance_bookings?status=eq.approved', { body: [BK()] }], ['reminder_sent_at=is.null', { method: 'PATCH', body: [BK()] }], ['/notify-admins', { method: 'POST', body: { ok: true } }]]);
  const jb = await (await runScope('booking')).json();
  chk('scope booking: 대관 푸시 1건, 팀 조회·문자 없음', jb.ok && jb.sent === 1 && jb.band_checked === 0 && !calls.some(c => c.url.includes('profiles?member_type') || c.url.includes('solapi')), JSON.stringify(jb));
  mockFetch([['performance_bookings?status=eq.approved', { body: [BK()] }], ...bandRoutes().slice(1)]);
  const jband = await (await runScope('band')).json();
  chk('scope band: 문자 1건, 대관 선점 PATCH 없음(checked 0)', jband.ok && jband.band_sent === 1 && jband.checked === 0 && jband.sent === 0 && !calls.some(c => c.method === 'PATCH' && c.url.includes('reminder_sent_at')), JSON.stringify(jband));
  Date.now = () => Date.parse('2026-10-01T12:00:00+09:00');
  mockFetch([['performance_bookings?status=eq.approved', { body: [] }], ...bandRoutes().slice(1)]);
  const j1 = await (await runScope('band')).json();
  chk('scope band 는 매월 1일에도 파기 안 함', j1.purged === 0 && !calls.some(c => c.method === 'DELETE' && c.url.includes('performance_bookings')));
}
// ── B6. 선점 경합(409) → 발송 없음 / 솔라피 실패 → 선점 롤백
{
  at('2026-10-06');
  mockFetch(bandRoutes({ claim: { status: 409, body: { message: 'duplicate key' } } }));
  const j = await (await run('POST', ENV_SMS)).json();
  chk('선점 409 → 솔라피 호출 없음, band_sent 0', j.band_sent === 0 && !calls.some(c => c.url.includes('api.solapi.com')));
  mockFetch(bandRoutes({ solapi: { status: 500 } }));
  const j2 = await (await run('POST', ENV_SMS)).json();
  const del = calls.find(c => c.method === 'DELETE' && c.url.includes('band_rent_reminders'));
  chk('솔라피 실패 → 선점 DELETE(타임스탬프 조건) + band_sent 0', j2.band_sent === 0 && !!del
    && del.url.includes(`team_id=eq.${TEAM_ID}`) && del.url.includes('cycle_no=eq.1') && del.url.includes('kind=eq.due') && del.url.includes('sent_at=eq.'),
    del && del.url.slice(del.url.indexOf('?')));
  chk('솔라피 실패 시 관리자 푸시 없음', !calls.some(c => c.url.includes('/notify-admins')));
}
// ── B7. 제외 조건 — 관리자 팀 / 사용료 미설정 / 연락처 불량
{
  at('2026-10-06');
  mockFetch(bandRoutes({ teams: [TEAM({ instruments: 'wearegatheo', band_name_kr: '게더링' }), TEAM({ id: '44444444-4444-4444-8444-444444444444', email: 'wearegatheo@band.gatheo.kr', instruments: 'x' })] }));
  const j = await (await run('POST', ENV_SMS)).json();
  chk('관리자 팀(로그인 ID·이메일 접두사 wearegatheo) 제외', j.band_checked === 0);
  mockFetch(bandRoutes({ teams: [TEAM({ band_fee: null })] }));
  await run('POST', ENV_SMS);
  const msg = solapiMsg();
  chk('사용료 미설정 → 금액 괄호 없이 "사용료를"', !!msg && msg.text.includes('\n사용료를 아래 계좌로') && !msg.text.includes('사용료('));
  mockFetch(bandRoutes({ teams: [TEAM({ leader_phone: '02-123-4567', phone: null })] }));
  const j3 = await (await run('POST', ENV_SMS)).json();
  chk('휴대폰 번호 아니면 선점·발송 없음', j3.band_checked === 1 && j3.band_sent === 0 && !claimBody());
}
// ── B8. 쿼리 조건 / 드라이런 / 솔라피 꺼짐
{
  at('2026-10-06');
  mockFetch(bandRoutes());
  await run('POST', ENV_SMS);
  const q = calls.find(c => c.url.includes('profiles?member_type=eq.band')).url;
  chk('팀 조회: 승인·시작일 있음·종료 안 됨', q.includes('status=eq.approved') && q.includes('band_start_date=not.is.null') && q.includes('band_ended_at=is.null'));
  mockFetch(bandRoutes());
  const g = await (await run('GET', ENV_SMS)).json();
  chk('GET 드라이런: 대상 요약만(PII 없음), 선점·발송 없음', g['월세_문자'] === '켜짐' && Array.isArray(g['월세_발송_대기']) && g['월세_발송_대기'].length === 1
    && g['월세_발송_대기'][0]['회차'] === 1 && g['월세_발송_대기'][0]['입금일'] === '2026-09-29'
    && !JSON.stringify(g).includes('아나하') && !JSON.stringify(g).includes('1995')
    && !calls.some(c => c.method === 'POST'), JSON.stringify(g));
  mockFetch([['performance_bookings?status=eq.approved', { body: [] }]]);
  const off = await (await run('POST', ENV)).json();
  chk('솔라피 키 없음 → 팀 조회조차 없음 + band: sms-disabled', off.band === 'sms-disabled' && !calls.some(c => c.url.includes('profiles')));
}


// ═══════════ 관리자 문자 테스트 액션 (test_band_sms) ═══════════
const ADMIN_UID = 'a0000000-0000-4000-8000-000000000001';
const ADMIN_PROF = { id: ADMIN_UID, name: '최경수', band_name_kr: '게더링', leader_phone: '010-5109-1042', phone: null, instruments: 'wearegatheo', email: 'wearegatheo@band.gatheo.kr', member_type: 'band', band_start_date: null, band_fee: null };
const runTest = (body, env = ENV_SMS) => onRequest({ request: new Request('https://gatherallaround.com/send-reminders', { method: 'POST', headers: { Origin: 'https://gatherallaround.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env });
const testRoutes = ({ user = { id: ADMIN_UID }, userStatus = 200, prof = ADMIN_PROF, solapi = 200 } = {}) => [
  ['/auth/v1/user', { status: userStatus, body: user }],
  ['profiles?id=eq.', { body: prof ? [prof] : [] }],
  ['api.solapi.com/messages', { method: 'POST', status: solapi, body: {} }],
];
{
  at('2026-09-15');
  mockFetch(testRoutes());
  const r = await runTest({ action: 'test_band_sms' });
  chk('테스트: sb_token 없음 → 401, 조회·발송 없음', r.status === 401 && !calls.some(c => c.url.includes('profiles') || c.url.includes('solapi')));
  mockFetch(testRoutes({ userStatus: 401, user: { message: 'invalid' } }));
  const r2 = await runTest({ action: 'test_band_sms', sb_token: 'bad' });
  chk('테스트: 만료 토큰 → 401', r2.status === 401);
  mockFetch(testRoutes({ prof: { ...ADMIN_PROF, instruments: 'vandor', email: 'vandor@band.gatheo.kr', band_name_kr: '벤더' } }));
  const r3 = await runTest({ action: 'test_band_sms', sb_token: 'tok' });
  chk('테스트: 일반 밴드 계정 → 403, 발송 없음', r3.status === 403 && !calls.some(c => c.url.includes('solapi')));
  mockFetch(testRoutes());
  const r4 = await runTest({ action: 'test_band_sms', sb_token: 'tok' });
  const j4 = await r4.json(); const msg = solapiMsg();
  chk('테스트: 게더링 계정 → 본인 번호로 [테스트] 문자, 오늘이 입금일인 샘플(다음 회차 9/29 시작)', r4.status === 200 && j4.ok === true && !!msg && msg.to === '01051091042'
    && msg.text.startsWith('[테스트] ') && msg.text.includes('[게더링] 팀 고정 합주 다음 회차(9/29(화)부터 4주) 사용료 입금일이 오늘(9/15)입니다.') && msg.text.includes('사용료(300,000원)'), (msg?.text || '').slice(0, 130));
  chk('테스트: 번호 마스킹 응답 + 선점·이력 기록 없음 + 관리자 푸시 없음', j4.to === '010****1042' && !calls.some(c => c.url.includes('band_rent_reminders') || c.url.includes('/notify-admins')), j4.to);
  mockFetch(testRoutes());
  await runTest({ action: 'test_band_sms', sb_token: 'tok', kind: 'last' });
  chk('테스트: kind last → 시작 전날 리마인드 문구', !!solapiMsg() && solapiMsg().text.includes('가 내일 시작됩니다'), (solapiMsg()?.text || '').slice(0, 130));
  mockFetch(testRoutes());
  await runTest({ action: 'test_band_sms', sb_token: 'tok', kind: 'week4' });
  chk('테스트: kind week4 → 시작 일주일 전 문구(다음 회차 9/22 시작)', !!solapiMsg() && solapiMsg().text.includes('다음 회차(9/22(화)부터 4주) 시작이 일주일 남았습니다'), (solapiMsg()?.text || '').slice(0, 130));
  mockFetch(testRoutes({ solapi: 500 }));
  const r5 = await runTest({ action: 'test_band_sms', sb_token: 'tok' });
  chk('테스트: 솔라피 실패 → 502', r5.status === 502);
  mockFetch([]);
  const r6 = await runTest({ action: 'test_band_sms', sb_token: 'tok' }, ENV);
  chk('테스트: 솔라피 키 없음 → 400 sms-disabled', r6.status === 400 && (await r6.json()).error === 'sms-disabled');
  // 크론 호출(본문 없음)은 그대로 정상 실행
  at('2026-09-15');
  mockFetch([['performance_bookings?status=eq.approved', { body: [] }]]);
  const r7 = await onRequest({ request: new Request('https://gatherallaround.com/send-reminders', { method: 'POST', headers: { Origin: 'https://gatherallaround.com' } }), env: ENV });
  chk('본문 없는 크론 POST → 정상 실행(ok)', r7.status === 200 && (await r7.json()).ok === true);
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
