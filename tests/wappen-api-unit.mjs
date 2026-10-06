// /wappen-api Cloudflare 함수 단위 테스트 — fetch 목으로 시나리오 검증
// 실행: node tests/wappen-api-unit.mjs
import { onRequest } from '../functions/wappen-api.js';
import { presetDims, presetLabel, isValidSize, exportSizes, PRESETS } from '../wappen/presets.js';
import { SEED_ITEMS } from '../wappen/seed/manifest.js';

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${l}${x ? '  [' + x + ']' : ''}`); c ? pass++ : fail++; };

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'sk-service' };
const UID = '11111111-1111-4111-8111-111111111111';   // 일반 사용자
const ADM = '22222222-2222-4222-8222-222222222222';   // 관리자
const PID = '33333333-3333-4333-8333-333333333333';   // 프로젝트
const WID = '44444444-4444-4444-8444-444444444444';   // 작품
const IT1 = '55555555-5555-4555-8555-555555555555';   // 와펜
const IT2 = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const FUTURE = new Date(Date.now() + 7 * 86400e3).toISOString();
const PAST = new Date(Date.now() - 3600e3).toISOString();
const PUB = (p) => `${ENV.SUPABASE_URL}/storage/v1/object/public/wappen/${p}`;

const req = (body, method = 'POST', headers = {}) =>
  new Request('https://gatherallaround.com/wappen-api', {
    method, headers: { Origin: 'https://gatherallaround.com', 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const run = (body, method = 'POST', headers) => onRequest({ request: req(body, method, headers), env: ENV });
const jrun = async (body, method, headers) => { const r = await run(body, method, headers); return { status: r.status, out: await r.json().catch(() => null) }; };

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
    try { rec.json = rec.body ? JSON.parse(rec.body) : null; } catch { rec.json = null; }
    calls.push(rec);
    for (const [pat, resp] of routes) {
      if (!rec.url.includes(pat)) continue;
      if (resp.method && resp.method !== rec.method) continue;
      if (resp.when && !resp.when(rec)) continue;
      const body = typeof resp.body === 'function' ? resp.body(rec) : resp.body;
      return new Response(JSON.stringify(body ?? {}), { status: resp.status ?? 200, headers: resp.headers || {} });
    }
    throw new Error('unexpected fetch: ' + rec.method + ' ' + rec.url);
  };
}
const isCount = (rec) => (rec.headers.Prefer || '').includes('count=exact');
const count = (pat, n, extra = {}) => [pat, { when: isCount, headers: { 'content-range': `0-0/${n}` }, body: [], ...extra }];
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

const USER = { id: UID, kakao_id: '777', nickname: '길동', avatar_url: 'https://k.kakaocdn.net/a.jpg', is_admin: false, is_banned: false, created_at: PAST, last_login_at: PAST };
const ADMIN = { ...USER, id: ADM, kakao_id: '4883868250', nickname: '게더링', is_admin: false }; // DB 플래그 없어도 카카오 ID 백스톱
const SESSION_OK = (user = USER) => ['wappen_sessions?token_hash=eq.', { body: [{ token_hash: 'h', expires_at: FUTURE, last_seen_at: new Date().toISOString(), wappen_users: user }] }];
const RL = ['auth_attempts', { headers: { 'content-range': '0-0/0' }, body: [] }]; // 한도 미도달 + 기록
const S = 'session-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KAPI_OK = ['kapi.kakao.com', { body: { id: 777, kakao_account: { profile: { nickname: '길동', thumbnail_image_url: 'https://k.kakaocdn.net/a.jpg' } } } }];

// ── 0. 프리셋 모듈
{
  chk('A4 300dpi = 2480×3508', JSON.stringify(presetDims('a4')) === '{"w":2480,"h":3508}');
  chk('A3 가로는 폭·높이 교환', JSON.stringify(presetDims('a3', 'landscape')) === '{"w":4961,"h":3508}');
  chk('SNS 는 dpi 무관 고정 px', JSON.stringify(presetDims('ig_story', 'portrait', 100)) === '{"w":1080,"h":1920}');
  chk('SNS 가로 선택 불가', !isValidSize('ig_square', 'landscape') && isValidSize('ig_square', 'portrait'));
  chk('없는 키 거부', !isValidSize('zzz', 'portrait'));
  chk('인쇄 dpi 폴백 4단계·내림차순', exportSizes('a1').map(s => s.dpi).join() === '300,200,150,100');
  chk('라벨 표기', presetLabel('a4', 'landscape') === 'A4 가로 · 297×210mm' && presetLabel('ig_square') === '인스타그램 정방형 · 1080×1080px');
  chk('키 형식은 DB check 와 일치', PRESETS.every(p => /^[a-z0-9_]{2,24}$/.test(p.key)));
}
// ── 1. CORS/메서드/출처
{
  mockFetch([]);
  const r = await run(null, 'OPTIONS');
  chk('OPTIONS: 허용 Origin 반사', r.headers.get('Access-Control-Allow-Origin') === 'https://gatherallaround.com');
  const r2 = await onRequest({ request: req({}, 'OPTIONS', { Origin: 'https://evil.example' }), env: ENV });
  chk('비허용 Origin → 기본 도메인 고정', r2.headers.get('Access-Control-Allow-Origin') === 'https://gatherallaround.com');
  chk('PUT: 405', (await run(null, 'PUT')).status === 405);
  const r3 = await onRequest({ request: new Request('https://gatherallaround.com/wappen-api', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }), env: ENV });
  chk('외부 출처 POST → 403', r3.status === 403 && calls.length === 0);
  const r4 = await onRequest({ request: new Request('https://gatherallaround.com/wappen-api', { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: '{}' }), env: ENV });
  chk('same-origin (Origin 없음) 은 출처 통과 → 세션 없음 401', r4.status === 401);
}
// ── 2. GET 진단
{
  mockFetch([
    ['rest/v1/wappen_', { body: [] }],
    ['rpc/wappen_ranking', { method: 'POST', body: [] }],
    ['storage/v1/bucket/wappen', { body: { id: 'wappen', public: true, file_size_limit: 8388608, allowed_mime_types: ['image/png'] } }],
  ]);
  const { status, out } = await jrun(null, 'GET');
  chk('GET 진단 200·테이블·RPC·버킷', status === 200 && out.wappen_users_테이블 === true && out.wappen_ranking_rpc === true && out.wappen_버킷 === true && out.버킷_공개 === true);
  chk('진단에 PII 없음', !JSON.stringify(out).includes('kakao_id'));
}
// ── 3. 로그인
{
  mockFetch([RL]);
  const { status } = await jrun({ action: 'login' });
  chk('토큰 없음 → 401, kapi 호출 없음', status === 401 && !calls.some(c => c.url.includes('kapi')));

  mockFetch([RL, ['kapi.kakao.com', { status: 401, body: {} }]]);
  chk('kapi 거절 → 401', (await jrun({ action: 'login', kakao_token: 'bad' })).status === 401);

  // 신규 사용자
  let inserted;
  mockFetch([RL, KAPI_OK,
    ['wappen_users?kakao_id=eq.777', { body: [] }],
    ['wappen_users', { method: 'POST', body: (rec) => { inserted = rec.json; return [{ ...USER, ...rec.json }]; } }],
    ['wappen_sessions', { method: 'POST', body: [] }],
    ['wappen_sessions?user_id=eq.', { method: 'DELETE', body: [] }],
  ]);
  let { status: s1, out: o1 } = await jrun({ action: 'login', kakao_token: 'good' });
  chk('신규 로그인 200·세션 발급', s1 === 200 && o1.ok && typeof o1.session === 'string' && o1.session.length >= 40);
  chk('신규 행: 닉네임·아바타·is_admin=false', inserted.nickname === '길동' && inserted.avatar_url === 'https://k.kakaocdn.net/a.jpg' && inserted.is_admin === false);
  chk('응답 user 에 kakao_id 없음', !('kakao_id' in o1.user) && o1.user.nickname === '길동');
  const sess = calls.find(c => c.method === 'POST' && c.url.endsWith('/wappen_sessions'));
  chk('세션 행은 sha256 해시만 저장', sess && sess.json.token_hash === await sha(o1.session) && sess.json.user_id === UID);

  // 기존 사용자: PATCH 만 (닉네임 유지), 차단은 403
  let patched;
  mockFetch([RL, KAPI_OK,
    ['wappen_users?kakao_id=eq.777', { body: [{ ...USER, nickname: '내가바꾼이름' }] }],
    ['wappen_users?id=eq.', { method: 'PATCH', body: (rec) => { patched = rec.json; return [{ ...USER, nickname: '내가바꾼이름', ...rec.json }]; } }],
    ['wappen_sessions', { method: 'POST', body: [] }],
    ['wappen_sessions?user_id=eq.', { method: 'DELETE', body: [] }],
  ]);
  ({ status: s1, out: o1 } = await jrun({ action: 'login', kakao_token: 'good' }));
  chk('기존 사용자: PATCH 에 nickname 없음(사용자 설정 유지)', s1 === 200 && patched && !('nickname' in patched) && 'last_login_at' in patched && o1.user.nickname === '내가바꾼이름');
  chk('기존 사용자: POST insert 없음', !calls.some(c => c.method === 'POST' && c.url.endsWith('/wappen_users')));

  mockFetch([RL, KAPI_OK, ['wappen_users?kakao_id=eq.777', { body: [{ ...USER, is_banned: true }] }], ['wappen_users?id=eq.', { method: 'PATCH', body: [{ ...USER, is_banned: true }] }]]);
  ({ status: s1, out: o1 } = await jrun({ action: 'login', kakao_token: 'good' }));
  chk('차단 사용자 로그인 → 403 banned·세션 미발급', s1 === 403 && o1.error === 'banned' && !calls.some(c => c.url.includes('wappen_sessions')));

  // 관리자 카카오 ID 신규 → is_admin true
  mockFetch([RL, ['kapi.kakao.com', { body: { id: 4883868250, properties: { nickname: '게더링' } } }],
    ['wappen_users?kakao_id=eq.4883868250', { body: [] }],
    ['wappen_users', { method: 'POST', body: (rec) => { inserted = rec.json; return [{ ...ADMIN, ...rec.json }]; } }],
    ['wappen_sessions', { method: 'POST', body: [] }], ['wappen_sessions?user_id=eq.', { method: 'DELETE', body: [] }]]);
  ({ status: s1, out: o1 } = await jrun({ action: 'login', kakao_token: 'good' }));
  chk('관리자 카카오 ID → is_admin', s1 === 200 && inserted.is_admin === true && o1.user.is_admin === true);

  mockFetch([['auth_attempts', { headers: { 'content-range': '0-0/30' }, body: [] }]]);
  chk('로그인 IP 한도 → 429', (await jrun({ action: 'login', kakao_token: 'x' })).status === 429);
}
// ── 4. 세션 인증
{
  mockFetch([['wappen_sessions?token_hash=eq.', { body: [] }]]);
  chk('세션 없음 → 401', (await jrun({ action: 'me', session: S })).status === 401);
  mockFetch([]);
  chk('세션 필드 누락 → 401 (조회 없음)', (await jrun({ action: 'me' })).status === 401 && calls.length === 0);

  mockFetch([['wappen_sessions?token_hash=eq.', { method: 'GET', body: [{ token_hash: 'h', expires_at: PAST, wappen_users: USER }] }], ['wappen_sessions?token_hash=eq.', { method: 'DELETE', body: [] }]]);
  chk('만료 세션 → 401 + 행 삭제', (await jrun({ action: 'me', session: S })).status === 401 && calls.some(c => c.method === 'DELETE'));

  mockFetch([SESSION_OK()]);
  const { status, out } = await jrun({ action: 'me', session: S });
  chk('me → 사용자(kakao_id 제외)', status === 200 && out.user.id === UID && !('kakao_id' in out.user));

  mockFetch([SESSION_OK({ ...USER, is_banned: true })]);
  chk('차단: 읽기(me) 허용', (await jrun({ action: 'me', session: S })).status === 200);
  chk('차단: 쓰기(project_create) 403', (await jrun({ action: 'project_create', session: S, title: 'x' })).out.error === 'banned');

  mockFetch([SESSION_OK(), ['wappen_sessions?token_hash=eq.', { method: 'DELETE', body: [] }]]);
  chk('logout → 세션 DELETE', (await jrun({ action: 'logout', session: S })).status === 200 && calls.some(c => c.method === 'DELETE' && c.url.includes('wappen_sessions?token_hash=eq.')));

  mockFetch([SESSION_OK(), ['wappen_users?id=eq.', { method: 'PATCH', body: (rec) => [{ ...USER, ...rec.json }] }],
    ['wappen_projects?owner_id=eq.', { method: 'PATCH', body: [] }], ['wappen_works?author_id=eq.', { method: 'PATCH', body: [] }]]);
  const mu = await jrun({ action: 'me_update', session: S, nickname: '  새이름  ' });
  chk('me_update: 닉네임 trim·복제 컬럼 동기화', mu.out.user.nickname === '새이름' && calls.filter(c => c.method === 'PATCH').length === 3);
  chk('me_update: 빈 닉네임 400', (await jrun({ action: 'me_update', session: S, nickname: '  ' })).status === 400);
}
// ── 5. 업로드 서명
{
  const SIGN = ['storage/v1/object/upload/sign/wappen/', { method: 'POST', body: (rec) => ({ url: rec.url.replace(ENV.SUPABASE_URL + '/storage/v1', '') + '?token=TKN' }) }];
  mockFetch([SESSION_OK(), RL, SIGN]);
  let { status, out } = await jrun({ action: 'upload_sign', session: S, kind: 'item', ext: 'png' });
  chk('와펜 업로드는 관리자만 → 403', status === 403);
  ({ status, out } = await jrun({ action: 'upload_sign', session: S, kind: 'base', ext: 'gif' }));
  chk('허용되지 않은 확장자 → 400', status === 400 && out.error === 'bad_ext');
  ({ status, out } = await jrun({ action: 'upload_sign', session: S, kind: 'base', ext: 'jpeg' }));
  chk('base: 사용자 폴더 경로·jpeg→jpg·토큰·공개 URL', status === 200 && out.path.startsWith(`base/${UID}/`) && out.path.endsWith('.jpg')
    && out.token === 'TKN' && out.content_type === 'image/jpeg' && out.upload_url.includes('?token=TKN') && out.public_url === PUB(out.path));
  mockFetch([SESSION_OK(ADMIN), RL, SIGN]);
  ({ status, out } = await jrun({ action: 'upload_sign', session: S, kind: 'item', ext: 'png' }));
  chk('관리자 item: items/ 경로 png', status === 200 && /^items\/[0-9a-f-]{36}\.png$/.test(out.path));
  mockFetch([SESSION_OK(), ['auth_attempts', { headers: { 'content-range': '0-0/200' }, body: [] }]]);
  chk('업로드 일일 한도 → 429', (await jrun({ action: 'upload_sign', session: S, kind: 'base', ext: 'jpg' })).status === 429);
}
// ── 6. 프로젝트
{
  let inserted;
  const base = PUB(`base/${UID}/x.jpg`);
  const routes = [SESSION_OK(), count('wappen_projects?owner_id=eq.', 3),
    ['wappen_projects', { method: 'POST', body: (rec) => { inserted = rec.json; return [{ id: PID, ...rec.json }]; } }]];
  mockFetch(routes);
  const ok = { action: 'project_create', session: S, title: ' 여름 포스터 ', size_key: 'a4', orientation: 'landscape', width_px: 3508, height_px: 2480, base_image_url: base };
  let { status, out } = await jrun(ok);
  chk('project_create 200·size_group·작성자 복제', status === 200 && inserted.size_group === 'print' && inserted.author_name === '길동' && inserted.title === '여름 포스터' && inserted.orientation === 'landscape');
  chk('잘못된 사이즈 → 400', (await jrun({ ...ok, size_key: 'a9' })).out.error === 'bad_size');
  chk('SNS 가로 → 400', (await jrun({ ...ok, size_key: 'ig_square' })).out.error === 'bad_size');
  chk('다른 사용자 폴더 이미지 → 400', (await jrun({ ...ok, base_image_url: PUB(`base/${OTHER}/x.jpg`) })).out.error === 'bad_image');
  chk('외부 URL → 400', (await jrun({ ...ok, base_image_url: 'https://evil.example/x.jpg' })).out.error === 'bad_image');
  chk('쿼리 붙은 URL → 400', (await jrun({ ...ok, base_image_url: base + '?x=1' })).out.error === 'bad_image');
  mockFetch([SESSION_OK(), count('wappen_projects?owner_id=eq.', 20)]);
  chk('하루 20개 한도 → 429', (await jrun(ok)).status === 429);

  // update/delete 권한
  const PROJ = { id: PID, owner_id: UID, title: 'p', status: 'active' };
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { method: 'GET', body: [{ ...PROJ, owner_id: OTHER }] }]]);
  chk('타인 프로젝트 수정 → 403', (await jrun({ action: 'project_update', session: S, project_id: PID, title: 'x' })).status === 403);
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { method: 'GET', body: [PROJ] }], ['wappen_projects?id=eq.', { method: 'PATCH', body: (rec) => [{ ...PROJ, ...rec.json }] }]]);
  ({ status, out } = await jrun({ action: 'project_update', session: S, project_id: PID, status: 'hidden' }));
  chk('소유자 숨김 → hidden', status === 200 && out.project.status === 'hidden');
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { method: 'GET', body: [PROJ] }], count('wappen_works?project_id=eq.', 2)]);
  chk('타인 작품 있는 프로젝트 삭제 → 409', (await jrun({ action: 'project_delete', session: S, project_id: PID })).out.error === 'has_works');
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { method: 'GET', body: [PROJ] }], count('wappen_works?project_id=eq.', 0), ['wappen_projects?id=eq.', { method: 'DELETE', body: [] }]]);
  chk('작품 없으면 삭제', (await jrun({ action: 'project_delete', session: S, project_id: PID })).status === 200);
}
// ── 7. 작품 저장
{
  let inserted;
  const PROJ = { id: PID, title: '프로젓', status: 'active', owner_id: OTHER };
  const preview = PUB(`previews/${UID}/p.jpg`);
  const layout = { v: 1, items: [{ id: IT1, x: 0.5, y: 0.5, w: 0.25, r: 15.123456789, fx: 1, junk: 'x' }, { id: IT2, x: 0.1, y: 0.9, w: 0.1 }] };
  const routes = () => [SESSION_OK(),
    ['wappen_projects?id=eq.', { body: [PROJ] }],
    ['wappen_items?id=in.', { body: [{ id: IT1 }, { id: IT2 }] }],
    count('wappen_works?author_id=eq.', 0),
    ['wappen_works', { method: 'POST', body: (rec) => { inserted = rec.json; return [{ id: WID, ...rec.json }]; } }],
  ];
  mockFetch(routes());
  const ok = { action: 'work_save', session: S, project_id: PID, title: '', layout, preview_url: preview, preview_w: 1080, preview_h: 1527 };
  let { status, out } = await jrun(ok);
  chk('work_save 200·제목 기본값=프로젝트명', status === 200 && out.work.id === WID && inserted.title === '프로젓');
  chk('레이아웃 정규화: 알 수 없는 키 제거·반올림·fx bool·r 기본 0', JSON.stringify(inserted.layout.items[0]) === JSON.stringify({ id: IT1, x: 0.5, y: 0.5, w: 0.25, r: 15.12346, fx: true })
    && inserted.layout.items[1].r === 0 && inserted.layout.items[1].fx === false);
  chk('작성자 복제·remix_of null', inserted.author_name === '길동' && inserted.remix_of === null && inserted.author_id === UID);
  chk('201개 → 400', (await jrun({ ...ok, layout: { v: 1, items: Array.from({ length: 201 }, () => ({ id: IT1, x: 0.5, y: 0.5, w: 0.2 })) } })).out.error === 'bad_layout');
  chk('범위 밖 좌표 → 400', (await jrun({ ...ok, layout: { v: 1, items: [{ id: IT1, x: 9, y: 0.5, w: 0.2 }] } })).out.error === 'bad_layout');
  chk('잘못된 버전 → 400', (await jrun({ ...ok, layout: { v: 2, items: [] } })).out.error === 'bad_layout');
  chk('타인 폴더 미리보기 → 400', (await jrun({ ...ok, preview_url: PUB(`previews/${OTHER}/p.jpg`) })).out.error === 'bad_image');
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { body: [PROJ] }], ['wappen_items?id=in.', { body: [{ id: IT1 }] }]]);
  chk('없는 와펜 id → 400', (await jrun(ok)).out.error === 'bad_layout');
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { body: [{ ...PROJ, status: 'hidden' }] }]]);
  chk('숨겨진 프로젝트 → 409', (await jrun(ok)).out.error === 'project_hidden');

  // 리믹스
  mockFetch([...routes(), ['wappen_works?id=eq.', { method: 'GET', body: [{ id: OTHER, project_id: PID, status: 'active' }] }]]);
  ({ status, out } = await jrun({ ...ok, remix_of: OTHER }));
  chk('remix_of 기록', status === 200 && inserted.remix_of === OTHER);
  mockFetch([...routes(), ['wappen_works?id=eq.', { method: 'GET', body: [{ id: OTHER, project_id: WID, status: 'active' }] }]]);
  chk('다른 프로젝트 원작 → 400', (await jrun({ ...ok, remix_of: OTHER })).out.error === 'bad_remix');

  // 수정
  let patched;
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { body: [PROJ] }], ['wappen_items?id=in.', { body: [{ id: IT1 }, { id: IT2 }] }],
    ['wappen_works?id=eq.', { method: 'GET', body: [{ id: WID, author_id: UID, project_id: PID }] }],
    ['wappen_works?id=eq.', { method: 'PATCH', body: (rec) => { patched = rec.json; return [{ id: WID, ...rec.json }]; } }]]);
  ({ status, out } = await jrun({ ...ok, work_id: WID, title: '수정됨' }));
  chk('본인 작품 수정 → PATCH', status === 200 && patched.title === '수정됨' && !('author_id' in patched));
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { body: [PROJ] }], ['wappen_items?id=in.', { body: [{ id: IT1 }, { id: IT2 }] }],
    ['wappen_works?id=eq.', { method: 'GET', body: [{ id: WID, author_id: OTHER, project_id: PID }] }]]);
  chk('타인 작품 수정 → 403', (await jrun({ ...ok, work_id: WID })).status === 403);
  mockFetch([SESSION_OK(), ['wappen_projects?id=eq.', { body: [PROJ] }], ['wappen_items?id=in.', { body: [{ id: IT1 }, { id: IT2 }] }], count('wappen_works?author_id=eq.', 100)]);
  chk('하루 100개 한도 → 429', (await jrun(ok)).status === 429);

  mockFetch([SESSION_OK(), ['wappen_works?id=eq.', { method: 'GET', body: [{ id: WID, author_id: OTHER }] }]]);
  chk('타인 작품 삭제 → 403', (await jrun({ action: 'work_delete', session: S, work_id: WID })).status === 403);
  mockFetch([SESSION_OK(ADMIN), ['wappen_works?id=eq.', { method: 'GET', body: [{ id: WID, author_id: OTHER }] }], ['wappen_works?id=eq.', { method: 'DELETE', body: [] }]]);
  chk('관리자는 타인 작품 삭제 가능', (await jrun({ action: 'work_delete', session: S, work_id: WID })).status === 200);
}
// ── 8. 반응
{
  const WORK = { id: WID, status: 'active', reaction_count: 3, reaction_counts: { love: 2, fire: 1 } };
  let upserted;
  mockFetch([SESSION_OK(), RL, ['wappen_works?id=eq.', { body: [WORK] }],
    ['wappen_reactions?on_conflict=work_id,user_id', { method: 'POST', body: (rec) => { upserted = rec; return []; } }],
    ['wappen_reactions?work_id=eq.', { method: 'DELETE', body: [] }]]);
  let { status, out } = await jrun({ action: 'react', session: S, work_id: WID, kind: 'fire' });
  chk('react: upsert(merge-duplicates)·집계 반환', status === 200 && upserted.headers.Prefer === 'resolution=merge-duplicates' && upserted.json.kind === 'fire'
    && !('created_at' in upserted.json) && out.mine === 'fire' && out.reaction_count === 3 && out.reaction_counts.love === 2);
  ({ status, out } = await jrun({ action: 'react', session: S, work_id: WID, kind: null }));
  chk('react null → DELETE', status === 200 && out.mine === null && calls.some(c => c.method === 'DELETE' && c.url.includes('wappen_reactions?work_id=eq.')));
  chk('알 수 없는 종류 → 400', (await jrun({ action: 'react', session: S, work_id: WID, kind: 'meh' })).out.error === 'bad_kind');
  mockFetch([SESSION_OK(), ['wappen_works?id=eq.', { body: [{ ...WORK, status: 'hidden' }] }]]);
  chk('숨긴 작품 반응 → 404', (await jrun({ action: 'react', session: S, work_id: WID, kind: 'love' })).status === 404);
  mockFetch([SESSION_OK(), ['wappen_reactions?user_id=eq.', { body: [{ work_id: WID, kind: 'wow' }] }]]);
  ({ status, out } = await jrun({ action: 'my_reactions', session: S, work_ids: [WID, 'bad'] }));
  chk('my_reactions 맵', status === 200 && out.reactions[WID] === 'wow');
}
// ── 9. 신고·요청
{
  mockFetch([SESSION_OK(), ['wappen_works?id=eq.', { body: [{ id: WID }] }], count('wappen_reports?reporter_id=eq.', 0), ['wappen_reports', { method: 'POST', status: 409, body: { code: '23505' } }]]);
  let { status, out } = await jrun({ action: 'report', session: S, target_type: 'work', target_id: WID, reason: 'spam' });
  chk('중복 신고 → 409', status === 409 && out.error === 'duplicate');
  chk('잘못된 사유 → 400', (await jrun({ action: 'report', session: S, target_type: 'work', target_id: WID, reason: 'zzz' })).out.error === 'bad_reason');
  mockFetch([SESSION_OK(), ['wappen_works?id=eq.', { body: [{ id: WID }] }], count('wappen_reports?reporter_id=eq.', 0), ['wappen_reports', { method: 'POST', status: 201, body: [] }]]);
  chk('신고 접수 200', (await jrun({ action: 'report', session: S, target_type: 'work', target_id: WID, reason: 'other', detail: 'x' })).status === 200);

  let inserted;
  mockFetch([SESSION_OK(), count('wappen_item_requests?user_id=eq.', 0), ['wappen_item_requests', { method: 'POST', body: (rec) => { inserted = rec.json; return [rec.json]; } }]]);
  ({ status } = await jrun({ action: 'request_create', session: S, name: '고양이', description: '검은 고양이', ref_image_url: PUB(`requests/${UID}/r.jpg`) }));
  chk('와펜 요청 저장', status === 200 && inserted.name === '고양이' && inserted.user_id === UID);
  chk('타인 폴더 참고 이미지 → 400', (await jrun({ action: 'request_create', session: S, name: '고양이', ref_image_url: PUB(`requests/${OTHER}/r.jpg`) })).out.error === 'bad_image');
  mockFetch([SESSION_OK(), count('wappen_item_requests?user_id=eq.', 10)]);
  chk('요청 하루 10건 → 429', (await jrun({ action: 'request_create', session: S, name: '고양이' })).status === 429);
}
// ── 10. 관리자
{
  mockFetch([SESSION_OK()]);
  chk('일반 사용자 admin_items → 403', (await jrun({ action: 'admin_items', session: S })).status === 403);
  chk('일반 사용자 admin_set_hidden → 403', (await jrun({ action: 'admin_set_hidden', session: S, target_type: 'work', target_id: WID, hidden: true })).status === 403);

  let inserted;
  mockFetch([SESSION_OK(ADMIN), ['wappen_items', { method: 'POST', body: (rec) => { inserted = rec.json; return [{ id: IT1, ...rec.json }]; } }]]);
  let { status, out } = await jrun({ action: 'admin_item_create', session: S, name: '별', category: '기호', tags: '#반짝, 별, 별, 밤하늘', image_url: PUB('items/a.png'), width_px: 500, height_px: 400 });
  chk('admin_item_create: 태그 정규화(중복·# 제거)', status === 200 && JSON.stringify(inserted.tags) === '["반짝","별","밤하늘"]' && inserted.created_by === ADM);
  chk('items/ 외 경로 → 400', (await jrun({ action: 'admin_item_create', session: S, name: '별', image_url: PUB(`base/${ADM}/a.png`), width_px: 10, height_px: 10 })).out.error === 'bad_image');

  mockFetch([SESSION_OK(ADMIN), count('wappen_works?layout=cs.', 2), ['wappen_items?id=eq.', { method: 'PATCH', body: [] }]]);
  ({ status, out } = await jrun({ action: 'admin_item_delete', session: S, item_id: IT1 }));
  chk('사용 중인 와펜 삭제 → 숨김 대체', status === 200 && out.hidden === true && out.used === 2);
  mockFetch([SESSION_OK(ADMIN), count('wappen_works?layout=cs.', 0), ['wappen_items?id=eq.', { method: 'DELETE', body: [] }]]);
  ({ status, out } = await jrun({ action: 'admin_item_delete', session: S, item_id: IT1 }));
  chk('미사용 와펜은 삭제', status === 200 && out.hidden === false);

  mockFetch([SESSION_OK(ADMIN), ['wappen_works?id=eq.', { method: 'PATCH', body: (rec) => [{ id: WID, ...rec.json }] }]]);
  ({ status, out } = await jrun({ action: 'admin_set_hidden', session: S, target_type: 'work', target_id: WID, hidden: true }));
  chk('admin_set_hidden → hidden', status === 200 && out.status === 'hidden');

  mockFetch([SESSION_OK(ADMIN), ['wappen_users?id=eq.', { method: 'GET', body: [{ id: OTHER, kakao_id: '999', is_admin: false }] }],
    ['wappen_users?id=eq.', { method: 'PATCH', body: [] }], ['wappen_sessions?user_id=eq.', { method: 'DELETE', body: [] }],
    ['wappen_works?author_id=eq.', { method: 'PATCH', body: [] }], ['wappen_projects?owner_id=eq.', { method: 'PATCH', body: [] }]]);
  ({ status, out } = await jrun({ action: 'admin_ban_user', session: S, user_id: OTHER, banned: true, reason: '스팸' }));
  chk('차단: 세션 삭제·콘텐츠 숨김', status === 200 && calls.some(c => c.method === 'DELETE' && c.url.includes('wappen_sessions?user_id=eq.'))
    && calls.some(c => c.method === 'PATCH' && c.url.includes('wappen_works?author_id=eq.')));
  chk('자기 자신 차단 → 400', (await jrun({ action: 'admin_ban_user', session: S, user_id: ADM, banned: true })).status === 400);
  mockFetch([SESSION_OK(ADMIN), ['wappen_users?id=eq.', { method: 'GET', body: [{ id: OTHER, kakao_id: '4883868250' }] }]]);
  chk('운영 관리자 차단 → 403', (await jrun({ action: 'admin_ban_user', session: S, user_id: OTHER, banned: true })).status === 403);
  chk('운영 관리자 권한 해제 → 403', (await jrun({ action: 'admin_set_admin', session: S, user_id: OTHER, is_admin: false })).status === 403);
  mockFetch([SESSION_OK(ADMIN), ['wappen_users?id=eq.', { method: 'GET', body: [{ id: OTHER, kakao_id: '999' }] }], ['wappen_users?id=eq.', { method: 'PATCH', body: [] }]]);
  chk('관리자 지정 200', (await jrun({ action: 'admin_set_admin', session: S, user_id: OTHER, is_admin: true })).status === 200);

  mockFetch([SESSION_OK(ADMIN), ['wappen_reports?select=', { body: [{ id: 'r1', target_type: 'work', target_id: WID, status: 'open' }, { id: 'r2', target_type: 'project', target_id: PID, status: 'open' }] }],
    ['wappen_works?id=in.', { body: [{ id: WID, title: 'w', preview_url: 'pv', status: 'active', author_name: 'a' }] }],
    ['wappen_projects?id=in.', { body: [{ id: PID, title: 'p', thumb_url: null, base_image_url: 'bi', status: 'active', owner_id: OTHER }] }]]);
  ({ status, out } = await jrun({ action: 'admin_reports', session: S }));
  chk('admin_reports: 대상 요약 첨부', status === 200 && out.reports[0].target.image === 'pv' && out.reports[1].target.image === 'bi' && out.reports[1].target.author_id === OTHER);
}
// ── 10b. 기본 와펜 세트
{
  const SEED_BASE = 'https://gatherallaround.com/wappen/seed/';
  mockFetch([SESSION_OK()]);
  chk('일반 사용자 admin_seed_items → 403', (await jrun({ action: 'admin_seed_items', session: S })).status === 403);
  let inserted;
  mockFetch([SESSION_OK(ADMIN), ['wappen_items?select=image_url&image_url=like.', { body: [{ image_url: SEED_BASE + SEED_ITEMS[0].file }, { image_url: SEED_BASE + SEED_ITEMS[1].file }] }],
    ['wappen_items', { method: 'POST', body: (rec) => { inserted = rec.json; return []; } }]]);
  let { status, out } = await jrun({ action: 'admin_seed_status', session: S });
  chk('admin_seed_status: 설치 2·미설치 N-2', status === 200 && out.total === SEED_ITEMS.length && out.installed === 2 && out.missing === SEED_ITEMS.length - 2);
  ({ status, out } = await jrun({ action: 'admin_seed_items', session: S }));
  chk('admin_seed_items: 없는 것만 한 번에 insert', status === 200 && out.added === SEED_ITEMS.length - 2 && out.skipped === 2 && Array.isArray(inserted) && inserted.length === SEED_ITEMS.length - 2);
  chk('seed 행: 정적 URL·크기·태그·작성자', inserted.every(r => r.image_url.startsWith(SEED_BASE) && r.width_px > 0 && r.height_px > 0 && Array.isArray(r.tags) && r.created_by === ADM && r.name && r.category)
    && !inserted.some(r => r.image_url.endsWith(SEED_ITEMS[0].file)));
  mockFetch([SESSION_OK(ADMIN), ['wappen_items?select=image_url&image_url=like.', { body: SEED_ITEMS.map(it => ({ image_url: SEED_BASE + it.file })) }]]);
  ({ status, out } = await jrun({ action: 'admin_seed_items', session: S }));
  chk('모두 설치됨 → insert 없이 added 0', status === 200 && out.added === 0 && !calls.some(c => c.method === 'POST' && c.url.endsWith('/wappen_items')));
}
// ── 11. 기타
{
  mockFetch([SESSION_OK()]);
  chk('알 수 없는 action → 400', (await jrun({ action: 'nope', session: S })).out.error === 'unknown_action');
  mockFetch([['wappen_sessions?token_hash=eq.', { status: 500, body: { message: 'boom' } }]]);
  const { status, out } = await jrun({ action: 'me', session: S });
  chk('내부 예외 → 500 JSON(internal)', status === 500 && out.error === 'internal');
  const r = await onRequest({ request: req({ action: 'me', session: S }), env: {} });
  chk('env 누락 → 500 env', r.status === 500 && (await r.json()).error === 'env');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
