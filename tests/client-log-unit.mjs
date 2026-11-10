// /client-log 단위 테스트 — 출처 검사·정리·개인정보 가림·표 없음 처리.  node tests/client-log-unit.mjs
import { onRequestPost, cleanEntry, scrub } from '../functions/client-log.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('✗', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'k' };
let calls = [], status = 201;
globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return new Response('', { status }); };
const origErr = console.error; console.error = () => {};
const req = (body, headers = { 'Sec-Fetch-Site': 'same-origin', 'User-Agent': 'UA/1.0' }) => new Request('https://gatherallaround.com/client-log', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

ok('가림: 이메일·전화·토큰', scrub('a hong@test.com 010-1234-5678 ' + 'x'.repeat(50)) === 'a [email] [phone] [token]');
const e = cleanEntry({ message: ' TypeError: x is not a function ', stack: 'at f (/index.html:1:2)', page: 'gatheo/reservation', source: '/index.html:10:5', kind: 'weird', role: 'root', extra: 'no' }, 'UA');
ok('정리: 허용 필드만·기본값', e.message === 'TypeError: x is not a function' && e.kind === 'error' && e.role === 'guest' && !('extra' in e) && e.ua === 'UA');
ok('빈 메시지 버림', cleanEntry({ message: '  ' }, 'UA') === null && cleanEntry(null, 'UA') === null);
ok('길이 제한', cleanEntry({ message: 'm'.repeat(2000) + ' ', stack: 's '.repeat(5000) }, 'UA').stack.length <= 3000);

let r = await onRequestPost({ request: req({ errors: [{ message: 'boom', page: 'band' }, { message: '' }] }), env });
ok('저장 204 · 1행', r.status === 204 && calls.length === 1 && calls[0].url.endsWith('/rest/v1/client_errors') && calls[0].body.length === 1 && calls[0].body[0].message === 'boom');
calls = []; r = await onRequestPost({ request: req({ errors: Array.from({ length: 9 }, (_, i) => ({ message: 'e' + i })) }), env });
ok('한 번에 5건까지', calls[0].body.length === 5);
calls = []; r = await onRequestPost({ request: req({ errors: [{ message: 'x' }] }, { Origin: 'https://evil.example' }), env });
ok('다른 출처 403', r.status === 403 && calls.length === 0);
r = await onRequestPost({ request: req('not json'), env }); ok('깨진 본문 400', r.status === 400);
r = await onRequestPost({ request: req(JSON.stringify({ errors: [{ message: 'x'.repeat(30000) }] })), env }); ok('너무 큰 본문 413', r.status === 413);
calls = []; r = await onRequestPost({ request: req({ errors: [] }), env }); ok('빈 목록은 저장 안 함', r.status === 204 && calls.length === 0);
calls = []; status = 404; r = await onRequestPost({ request: req({ errors: [{ message: 'x' }] }), env }); ok('표 없어도 204', r.status === 204);
r = await onRequestPost({ request: req({ errors: [{ message: 'x' }] }), env: {} }); ok('환경변수 없어도 204', r.status === 204);
console.error = origErr;
console.log(`${pass + fail}개 중 ${pass} 통과`);
process.exit(fail ? 1 : 0);
