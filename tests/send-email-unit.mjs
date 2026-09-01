// /send-email Cloudflare 함수 단위 테스트 — fetch 목으로 시나리오 검증
// 실행: node tests/send-email-unit.mjs
import { onRequest } from '../functions/send-email.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service', RESEND_API_KEY: 're-key' };
const MT_ID = '11111111-1111-4111-8111-111111111111';
const AP_ID = '22222222-2222-4222-8222-222222222222';

const req = (body, method = 'POST') =>
  new Request('https://gatherallaround.com/send-email', {
    method, headers: { Origin: 'https://gatherallaround.com', 'Content-Type': 'application/json' },
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
        return new Response(JSON.stringify(typeof resp.body === 'function' ? resp.body(rec) : (resp.body ?? {})), { status: resp.status ?? 200 });
      }
    }
    throw new Error('unexpected fetch: ' + rec.method + ' ' + rec.url);
  };
}

const MEETING = (over = {}) => ({
  id: MT_ID, title: '비트윈 밴즈', organizer_name: '최경수', organizer_email: 'host@example.com',
  meeting_date: '2026-09-18', meeting_time: '19:00', location: '게더 올 어라운드', ...over,
});
const APP = (over = {}) => ({
  id: AP_ID, meeting_id: MT_ID, applicant_name: '홍길동', applicant_phone: '010-1234-5678',
  form_data: { '참여신청 경로': '인스타그램', '하고 싶은 말': '첫줄\n둘째줄' }, notified_at: null, ...over,
});
const resendCall = () => {
  const c = calls.find(c => c.url.includes('api.resend.com'));
  return c ? JSON.parse(c.body) : null;
};

// ── 1. 입력 검증·설정
{
  mockFetch([]);
  const r = await run({ meeting_id: 'x', application_id: AP_ID });
  chk('UUID 아니면 400', r.status === 400 && calls.length === 0);

  mockFetch([]);
  const j = await (await run({ meeting_id: MT_ID, application_id: AP_ID }, 'POST', { ...ENV, RESEND_API_KEY: '' })).json();
  chk('RESEND_API_KEY 미설정 → email-disabled skip', j.skipped === 'email-disabled' && calls.length === 0);
}
// ── 2. 정상 발송 — 서버가 DB에서 조회해 구성 (임의 수신자·내용 불가)
{
  mockFetch([
    ['community_meetings?id=eq.' + MT_ID, { body: [MEETING()] }],
    ['community_applications?id=eq.' + AP_ID + '&select=', { body: [APP()] }],
    ['notified_at=is.null', { method: 'PATCH', body: [APP()] }],
    ['api.resend.com', { method: 'POST', body: { id: 'em_1' } }],
  ]);
  const r = await run({ meeting_id: MT_ID, application_id: AP_ID });
  const j = await r.json();
  const mail = resendCall();
  chk('정상 발송: ok', r.status === 200 && j.ok === true);
  chk('수신자 = 모임장 이메일(서버 조회)', !!mail && mail.to === 'host@example.com');
  chk('제목·본문: 모임명·신청자·추가 항목', !!mail && mail.subject === '[비트윈 밴즈] 신규 신청: 홍길동'
    && mail.html.includes('홍길동') && mail.html.includes('010-1234-5678') && mail.html.includes('인스타그램')
    && mail.html.includes('2026.09.18'), mail && mail.subject);
  chk('본문: 여러 줄 답변은 <br> 변환 + 신청자 정보에 nowrap 없음(긴 질문 안전)',
    !!mail && mail.html.includes('첫줄<br>둘째줄')
    && !mail.html.split('신청자 정보')[1].includes('white-space:nowrap'));
  chk('선점 PATCH가 발송보다 먼저', calls.findIndex(c => c.method === 'PATCH') < calls.findIndex(c => c.url.includes('api.resend.com')));
}
// ── 3. 본문 XSS 이스케이프
{
  mockFetch([
    ['community_meetings?id=eq.' + MT_ID, { body: [MEETING({ title: '<script>x</script>모임' })] }],
    ['community_applications?id=eq.' + AP_ID + '&select=', { body: [APP({ applicant_name: '<b>공격</b>' })] }],
    ['notified_at=is.null', { method: 'PATCH', body: [APP()] }],
    ['api.resend.com', { method: 'POST', body: {} }],
  ]);
  await run({ meeting_id: MT_ID, application_id: AP_ID });
  const mail = resendCall();
  chk('HTML 이스케이프', !!mail && !mail.html.includes('<script>') && mail.html.includes('&lt;b&gt;공격&lt;/b&gt;'));
}
// ── 4. 재발송 방지·불일치
{
  mockFetch([
    ['community_meetings?id=eq.' + MT_ID, { body: [MEETING()] }],
    ['community_applications?id=eq.' + AP_ID + '&select=', { body: [APP()] }],
    ['notified_at=is.null', { method: 'PATCH', body: [] }],
  ]);
  const j = await (await run({ meeting_id: MT_ID, application_id: AP_ID })).json();
  chk('선점 실패 → already-sent, Resend 호출 없음', j.skipped === 'already-sent' && !calls.some(c => c.url.includes('api.resend.com')));

  mockFetch([
    ['community_meetings?id=eq.' + MT_ID, { body: [MEETING()] }],
    ['community_applications?id=eq.' + AP_ID + '&select=', { body: [APP({ meeting_id: '99999999-9999-4999-8999-999999999999' })] }],
  ]);
  const r = await run({ meeting_id: MT_ID, application_id: AP_ID });
  chk('신청-모임 불일치 → 404', r.status === 404);
}
// ── 5. Resend 실패 → 선점 롤백
{
  mockFetch([
    ['community_meetings?id=eq.' + MT_ID, { body: [MEETING()] }],
    ['community_applications?id=eq.' + AP_ID + '&select=', { body: [APP()] }],
    ['notified_at=is.null', { method: 'PATCH', body: [APP()] }],
    ['notified_at=eq.', { method: 'PATCH', body: [] }],
    ['api.resend.com', { method: 'POST', status: 500, body: { error: 'boom' } }],
  ]);
  const r = await run({ meeting_id: MT_ID, application_id: AP_ID });
  const rollback = calls.find(c => c.method === 'PATCH' && c.url.includes('notified_at=eq.'));
  chk('Resend 실패 → 502 + 선점 롤백', r.status === 502 && !!rollback && JSON.parse(rollback.body).notified_at === null);
}
// ── 6. GET 진단
{
  mockFetch([['community_applications?select=notified_at,status', { body: [] }]]);
  const j = await (await run(null, 'GET')).json();
  chk('GET 진단: 설정 상태 + 20260901 컬럼 확인', j['환경변수_SUPABASE'] === true && j['환경변수_RESEND'] === true
    && j['컬럼_20260901_SQL'] === true, JSON.stringify(j).slice(0, 120));

  mockFetch([['community_applications?select=notified_at,status', { status: 400, body: { message: 'column does not exist' } }]]);
  const j2 = await (await run(null, 'GET')).json();
  chk('GET 진단: 컬럼 미적용이면 false + 오류 표시', j2['컬럼_20260901_SQL'] === false && !!j2['컬럼_오류']);
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
