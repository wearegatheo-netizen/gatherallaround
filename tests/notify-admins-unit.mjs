// /notify-admins Cloudflare 함수 단위 테스트 — 역할 필터(roles) 검증
// 실행: node tests/notify-admins-unit.mjs
import { onRequest } from '../functions/notify-admins.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service' };
const req = (body) => new Request('https://gatherallaround.co.kr/notify-admins', {
  method: 'POST', headers: { Origin: 'https://gatherallaround.co.kr', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const run = (body) => onRequest({ request: req(body), env: ENV });

let calls;
function mockFetch() {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    if (String(url).includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify([{ push_subscription: { endpoint: 'https://p.test/x', keys: {} } }]), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 }); // /push
  };
}
const roleQuery = () => decodeURIComponent(calls.find(c => c.url.includes('/rest/v1/profiles')).url);

// ── 1. 기본: 세 역할 전체
{
  mockFetch();
  const j = await (await run({ title: 't', body: 'b' })).json();
  chk('기본 수신: 운영 총괄·총괄·세션장', j.ok === true && roleQuery().includes('in.("운영 총괄","총괄","세션장")'));
}
// ── 2. roles로 좁히기
{
  mockFetch();
  await (await run({ title: 't', body: 'b', roles: ['운영 총괄'] })).json();
  const q = roleQuery();
  chk('roles [운영 총괄]: 해당 역할만 조회', q.includes('in.("운영 총괄")') && !q.includes('세션장'), q.slice(q.indexOf('role='), q.indexOf('role=') + 60));
}
// ── 3. 허용 밖 역할은 무시 → 기본 집합 (넓히기 불가)
{
  mockFetch();
  await (await run({ title: 't', body: 'b', roles: ['해커', '일반 멤버'] })).json();
  chk('허용 밖 roles → 기본 집합 폴백', roleQuery().includes('in.("운영 총괄","총괄","세션장")'));
  mockFetch();
  await (await run({ title: 't', body: 'b', roles: ['세션장', '아무개'] })).json();
  const q = roleQuery();
  chk('혼합 roles → 허용된 것만', q.includes('in.("세션장")') && !q.includes('아무개'), q.slice(q.indexOf('role=') , q.indexOf('role=') + 50));
}
// ── 4. 입력 검증
{
  mockFetch();
  const r = await run({ title: '', body: 'b' });
  chk('title 누락 → 400, 조회 없음', r.status === 400 && calls.length === 0);
}

console.log(`\n${pass + fail}개 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
