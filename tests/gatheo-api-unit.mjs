// /gatheo-api 단위 테스트 — fetch 를 가짜로 바꿔 신원·규칙·PostgREST 변환을 검사한다.  node tests/gatheo-api-unit.mjs
import { handle, signSession, verifySession, parseCalls, buildQuery, makeActor } from '../functions/gatheo-api.js';

const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('✗', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// ── 가짜 백엔드 ──
const ADMIN_KID = '4883868250';
const P = {
    member: { id: '11111111-1111-4111-8111-111111111111', kakao_id: 'k-member', name: '멤버', status: 'approved', role: '일반' },
    mgr:    { id: '22222222-2222-4222-8222-222222222222', kakao_id: 'k-mgr', name: '세션장', status: 'approved', role: '세션장' },
    lead:   { id: '33333333-3333-4333-8333-333333333333', kakao_id: 'k-lead', name: '총괄', status: 'approved', role: '총괄' },
    sup:    { id: '44444444-4444-4444-8444-444444444444', kakao_id: 'k-sup', name: '운영', status: 'approved', role: '운영 총괄' },
    pend:   { id: '55555555-5555-4555-8555-555555555555', kakao_id: 'k-pend', name: '대기', status: 'pending', role: '일반' },
    band:   { id: '66666666-6666-4666-8666-666666666666', name: '팀', status: 'approved', member_type: 'band', instruments: 'vandor', band_name_kr: '반도' },
    badmin: { id: '77777777-7777-4777-8777-777777777777', name: '게더링', status: 'approved', member_type: 'band', instruments: 'wearegatheo', band_name_kr: '게더링' },
    email:  { id: '99999999-9999-4999-8999-999999999999', name: '이메일멤버', email: 'em@example.com', status: 'approved', role: '일반', kakao_id: null },
    linked: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '연결멤버', email: 'ln@example.com', status: 'approved', role: '일반', kakao_id: 'k-linked' },
};
const AUTH_USERS = new Set(['99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']); // 이메일 로그인 계정이 있는 프로필 id
const SB = { 'jwt-band': { id: P.band.id, email: 'vandor@band.gatheo.kr' }, 'jwt-badmin': { id: P.badmin.id, email: 'wearegatheo@band.gatheo.kr' }, 'jwt-new': { id: '88888888-8888-4888-8888-888888888888', email: 'newteam@band.gatheo.kr' },
    'jwt-email': { id: P.email.id, email: 'em@example.com' }, 'jwt-linked': { id: P.linked.id, email: 'ln@example.com' } };
let log = [], canned = {};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith('https://kapi.kakao.com')) { const t = (opts.headers.Authorization || '').slice(7); return t.startsWith('kt-') ? json({ id: t.slice(3) }) : json({}, 401); }
    if (url.includes('/auth/v1/admin/users/')) { const id = url.split('/auth/v1/admin/users/')[1]; return AUTH_USERS.has(id) ? json({ id }) : json({ msg: 'User not found' }, 404); }
    if (url.includes('/auth/v1/user')) { const u = SB[(opts.headers.Authorization || '').slice(7)]; return u ? json(u) : json({}, 401); }
    const path = decodeURIComponent(url.split('/rest/v1/')[1] || '');
    const method = opts.method || 'GET';
    // 요청자 프로필 조회
    let m = path.match(/^profiles\?select=\*&(kakao_id|id)=eq\.([^&]+)&limit=1$/);
    if (m && method === 'GET' && !log._recordAll) { const row = Object.values(P).find(p => String(p[m[1]]) === m[2]); return json(row ? [row] : []); }
    log.push({ method, path, body: opts.body ? JSON.parse(opts.body) : null, prefer: (opts.headers || {}).Prefer || '' });
    for (const k of Object.keys(canned)) if (path.startsWith(k)) { const c = canned[k]; return typeof c === 'function' ? c(path, method) : json(c); }
    return method === 'GET' ? json([]) : (/(return=representation)/.test((opts.headers || {}).Prefer || '') ? json([{ id: 'new' }]) : new Response('', { status: 201 }));
};
const sess = async (kid) => (await signSession(env, kid)).session;
const db = async (ids, table, calls) => { log = []; const [st, body] = await handle(env, { action: 'db', table, calls, ...ids }); return { st, ...body }; };
const last = () => log[log.length - 1] || {};
const future = (d) => new Date(Date.now() + 9 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);

// ── 1. 세션 ──
{
    const s = await signSession(env, 'k1');
    ok('세션 검증', await verifySession(env, s.session) === 'k1');
    ok('세션 변조 거부', await verifySession(env, s.session.slice(0, -2) + 'xx') === null);
    const [pl, sg] = s.session.split('.');
    ok('페이로드 변조 거부', await verifySession(env, btoa(JSON.stringify({ k: ADMIN_KID, e: Date.now() + 1e9 })).replace(/=+$/, '') + '.' + sg) === null);
    ok('만료 거부', await verifySession(env, s.session, Date.now() + 31 * 86400e3) === null);
    ok('다른 키로 서명 거부', await verifySession({ ...env, SUPABASE_SERVICE_ROLE_KEY: 'other' }, s.session) === null);
    const [st, body] = await handle(env, { action: 'login', kakao_token: 'kt-k-member' });
    ok('login → 세션+프로필', st === 200 && body.session && body.profile && body.profile.name === '멤버' && body.kakao_id === 'k-member');
    ok('login 잘못된 토큰 401', (await handle(env, { action: 'login', kakao_token: 'bad' }))[0] === 401);
    ok('ping', (await handle(env, { action: 'ping' }))[1].ok === true);
    ok('무효 세션 401', (await handle(env, { action: 'db', table: 'notices', calls: [['insert', { title: 'x' }]], session: 'a.b' }))[0] === 401);
}

// ── 2. 변환 ──
{
    const spec = parseCalls([['update', { a: 1 }], ['eq', 'id', 'x y'], ['in', 'status', ['pending', 'a"b']], ['not', 'kakao_id', 'is', null], ['select', 'id'], ['single']]);
    const q = buildQuery('t', spec, ['kakao_id=eq.k1']);
    ok('PATCH + 필터', q.method === 'PATCH' && q.path.includes('id=eq.x%20y') && q.path.includes('kakao_id=not.is.null') && q.path.includes('kakao_id=eq.k1') && q.prefer === 'return=representation', q);
    ok('in 따옴표', decodeURIComponent(q.path).includes('status=in.("pending","a\\"b")'), decodeURIComponent(q.path));
    const u = buildQuery('profiles', parseCalls([['upsert', { id: 'a' }, { onConflict: 'id' }]]));
    ok('upsert', u.method === 'POST' && u.prefer.includes('resolution=merge-duplicates') && u.path.includes('on_conflict=id'));
    const bad = (calls) => { try { parseCalls(calls); return false; } catch (_) { return true; } };
    ok('필터 없는 delete 거부', bad([['delete']]));
    ok('필터 없는 update 거부', bad([['update', { a: 1 }]]));
    ok('이상한 컬럼 거부', bad([['update', { a: 1 }], ['eq', 'id;drop', 1]]));
    ok('or 메서드 거부', bad([['select', '*'], ['or', 'a.eq.1']]));
    ok('select 임베드 거부', bad([['select', 'id,profiles(*)']]));
    ok('값 키 검사', bad([['insert', { 'a b': 1 }]]));
}

// ── 3. 권한 ──
{
    const mem = { session: await sess('k-member') }, mgr = { session: await sess('k-mgr') }, lead = { session: await sess('k-lead') }, sup = { session: await sess('k-sup') },
        pend = { session: await sess('k-pend') }, nobody = { session: await sess('k-nobody') }, band = { sb_token: 'jwt-band' }, badmin = { sb_token: 'jwt-badmin' };
    let r;
    // 공지 — 총괄 이상
    r = await db({}, 'notices', [['insert', [{ title: 'x' }]]]); ok('익명 공지 거부', r.error && r.error.code === 'UNAUTHORIZED' && !log.length, r);
    r = await db(mem, 'notices', [['insert', [{ title: 'x' }]]]); ok('일반 멤버 공지 거부', r.error && r.error.code === 'FORBIDDEN' && !log.length);
    r = await db(mgr, 'notices', [['insert', [{ title: 'x' }]]]); ok('세션장 공지 거부', !!r.error);
    r = await db(lead, 'notices', [['insert', [{ title: 'x' }]]]); ok('총괄 공지 허용', !r.error && last().method === 'POST' && last().path.startsWith('notices'));
    r = await db(pend, 'comments', [['insert', [{ content: 'x' }]]]); ok('승인 대기는 글 못 씀', !!r.error && !log.length);
    r = await db(mgr, 'documents', [['delete'], ['eq', 'id', 'd1']]); ok('세션장 문서 삭제', !r.error && last().method === 'DELETE');
    r = await db(mem, 'schedules', [['delete'], ['eq', 'date', '2026-12-01']]); ok('일반 멤버 일정 삭제 거부', !!r.error && !log.length);
    r = await db(mem, 'schedule_attendees', [['insert', { schedule_date: '2026-12-01', profile_id: P.member.id }]]); ok('멤버 참석 신청', !r.error);
    r = await db(mem, 'bogus', [['insert', { a: 1 }]]); ok('모르는 표 거부', r.error && r.error.code === 'BAD_TABLE');
    r = await db(mem, 'reservations', [['select', '*']]); ok('읽기 대행은 profiles·대관만', r.error && r.error.code === 'BAD_TABLE');

    // 예약
    const d = future(3);
    r = await db({}, 'reservations', [['insert', [{ res_date: d, start_time: '10:00', end_time: '10:00' }]]]); ok('익명 예약 거부', r.error && r.error.code === 'UNAUTHORIZED');
    r = await db(mem, 'reservations', [['insert', [{ kakao_id: 'spoof', user_name: 'x', res_date: d, start_time: '10:00', end_time: '13:00', status: 'approved' }]]]);
    ok('멤버 예약: 신원·상태 강제', !r.error && last().body[0].kakao_id === 'k-member' && last().body[0].status === 'pending', last().body);
    r = await db(mem, 'reservations', [['insert', [{ res_date: d, start_time: '10:00', end_time: '11:00', status: 'pending' }]]]); ok('2시간 이하는 자동 승인', last().body[0].status === 'approved');
    r = await db(mem, 'reservations', [['insert', [{ res_date: future(90), start_time: '10:00', end_time: '10:00' }]]]); ok('2개월 제한', !!r.error && /2개월/.test(r.error.message));
    r = await db(mgr, 'reservations', [['insert', [{ res_date: future(90), start_time: '10:00', end_time: '14:00', status: 'approved' }]]]); ok('관리자는 제한 없음·승인', !r.error && last().body[0].status === 'approved');
    canned = { 'reservations?select=id&kakao_id=eq.k-member&created_at=gte.': [{ id: 'r' }] };
    r = await db(mem, 'reservations', [['insert', [{ res_date: d, start_time: '10:00', end_time: '10:00' }]]]); ok('5분 제한', r.error && r.error.code === 'RATE_LIMIT');
    canned = { 'reservations?select=start_time': [{ start_time: '11:00', end_time: '12:00', status: 'approved' }] };
    r = await db(mem, 'reservations', [['insert', [{ res_date: d, start_time: '10:00', end_time: '11:00' }]]]); ok('겹치면 SLOT_TAKEN', r.error && r.error.code === 'SLOT_TAKEN');
    r = await db(mem, 'reservations', [['insert', [{ res_date: d, start_time: '09:00', end_time: '10:00' }]]]); ok('안 겹치면 통과', !r.error);
    canned = { 'reservations?select=start_time': [{ start_time: '11:00', end_time: '12:00', status: 'rejected' }], 'performance_bookings?select=start_time': [{ start_time: '11:00', end_time: '12:00', status: 'pending', created_at: new Date(Date.now() - 5 * 3600e3).toISOString() }] };
    r = await db(mem, 'reservations', [['insert', [{ res_date: d, start_time: '11:00', end_time: '11:00' }]]]); ok('거절 예약·만료 대관은 안 막음', !r.error);
    canned = { 'performance_bookings?select=start_time': [{ start_time: '11:00', end_time: '12:00', status: 'pending', created_at: new Date().toISOString() }] };
    r = await db(mem, 'reservations', [['insert', [{ res_date: d, start_time: '12:00', end_time: '12:00' }]]]); ok('입금 대기 대관과 겹침', r.error && r.error.code === 'SLOT_TAKEN');
    canned = {};
    r = await db(mem, 'reservations', [['delete'], ['eq', 'id', 'r1']]); ok('멤버 취소는 본인 것만', !r.error && last().path.includes('kakao_id=eq.k-member'), last().path);
    r = await db(sup, 'reservations', [['delete'], ['eq', 'id', 'r1']]); ok('운영 총괄은 전체 취소', !r.error && !last().path.includes('kakao_id=eq.'));
    r = await db(mgr, 'reservations', [['delete'], ['eq', 'id', 'r1']]); ok('세션장 취소는 본인 것만', last().path.includes('kakao_id=eq.k-mgr'));
    r = await db(mem, 'reservations', [['update', { status: 'approved' }], ['eq', 'id', 'r1']]); ok('멤버 승인 거부', !!r.error && !log.length);
    r = await db(mem, 'reservations', [['update', { participant_ids: [], participant_etc: null }], ['eq', 'id', 'r1']]); ok('멤버 참여자 수정', !r.error);
    r = await db(mgr, 'reservations', [['update', { status: 'approved' }], ['eq', 'id', 'r1']]); ok('세션장 승인', !r.error);

    // 프로필
    r = await db({}, 'profiles', [['select', '*']]); ok('익명 프로필 읽기 거부', r.error && r.error.code === 'UNAUTHORIZED');
    r = await db(mem, 'profiles', [['select', '*'], ['order', 'created_at', { ascending: false }]]);
    ok('멤버: 합주팀 행 제외', !r.error && last().path.includes('or=(member_type.is.null,member_type.neq.band)') && last().path.includes('order=created_at.desc'), last().path);
    canned = { 'profiles?': [{ id: P.member.id, push_subscription: { a: 1 } }, { id: 'other', push_subscription: { b: 1 } }] };
    r = await db(mem, 'profiles', [['select', '*']]); ok('남의 푸시 구독은 가림', r.data[0].push_subscription && r.data[1].push_subscription === null, r.data);
    canned = {};
    r = await db(mgr, 'profiles', [['select', '*']]); ok('관리자: 전체', !last().path.includes('member_type'));
    r = await db(pend, 'profiles', [['select', '*'], ['eq', 'kakao_id', 'k-other'], ['maybeSingle']]); ok('승인 대기: 본인 행만', last().path.includes('kakao_id=eq.k-pend') && r.data === null, last().path);
    r = await db(nobody, 'profiles', [['select', '*'], ['eq', 'kakao_id', 'k-nobody'], ['maybeSingle']]); ok('미가입: 본인 필터', last().path.includes('kakao_id=eq.k-nobody'));
    r = await db(band, 'profiles', [['select', 'id, band_name_kr, band_name_en, leader_name, leader_phone, timeslots, band_ended_at, band_end_date'], ['eq', 'member_type', 'band']]);
    ok('합주팀: 팀 목록 공개 컬럼', !r.error && last().path.includes('status=eq.approved') && !last().path.includes(`id=eq.${P.band.id}`));
    r = await db(band, 'profiles', [['select', '*'], ['eq', 'member_type', 'band']]); ok('합주팀: * 는 본인 행만', last().path.includes(`id=eq.${P.band.id}`));
    r = await db(badmin, 'profiles', [['select', '*'], ['eq', 'member_type', 'band']]); ok('운영 계정: 전체', !last().path.includes(`id=eq.${P.badmin.id}`));
    r = await db(mem, 'profiles', [['update', { phone: '010', instruments: '기타', music_taste: 'x' }], ['eq', 'id', P.member.id]]); ok('본인 정보 수정', !r.error && last().path.includes('kakao_id=eq.k-member'));
    r = await db(mem, 'profiles', [['update', { role: '운영 총괄' }], ['eq', 'id', P.member.id]]); ok('본인 역할 올리기 거부', !!r.error && !log.length);
    r = await db(mem, 'profiles', [['update', { status: 'approved' }], ['eq', 'id', P.pend.id]]); ok('멤버가 가입 승인 거부', !!r.error && !log.length);
    r = await db(mem, 'profiles', [['update', { phone: '1' }], ['eq', 'id', P.mgr.id]]); ok('남의 연락처 수정 거부', !!r.error && !log.length);
    r = await db(mgr, 'profiles', [['update', { status: 'approved' }], ['eq', 'id', P.pend.id]]); ok('세션장 가입 승인(게더링 행만)', !r.error && last().path.includes('member_type.neq.band'));
    r = await db(mgr, 'profiles', [['update', { role: '총괄' }], ['eq', 'id', P.pend.id]]); ok('세션장 역할 변경 거부', !!r.error);
    r = await db(sup, 'profiles', [['update', { role: '총괄' }], ['eq', 'id', P.pend.id]]); ok('운영 총괄 역할 변경', !r.error);
    r = await db(mgr, 'profiles', [['update', { instruments: 'WeAreGatheo' }], ['eq', 'id', P.pend.id]]); ok('운영 계정 표식 심기 거부', !!r.error && !log.length);
    r = await db(mem, 'profiles', [['update', { kakao_id: 'x' }], ['eq', 'id', P.member.id]]); ok('kakao_id 직접 변경 거부', !!r.error);
    r = await db(band, 'profiles', [['update', { band_fee: 1 }], ['eq', 'id', P.band.id]]); ok('팀이 이용료 수정 거부', !!r.error && !log.length);
    r = await db(band, 'profiles', [['update', { band_name_kr: '게더링', leader_name: 'x' }], ['eq', 'id', P.band.id]]); ok('예약어 밴드명 거부', !!r.error);
    r = await db(band, 'profiles', [['update', { leader_name: 'x', leader_phone: '010' }], ['eq', 'id', P.band.id]]); ok('팀 본인 정보 수정', !r.error && last().path.includes(`id=eq.${P.band.id}`));
    r = await db(badmin, 'profiles', [['update', { band_fee: 1, status: 'approved' }], ['eq', 'id', P.band.id]]); ok('운영 계정 계약 수정(합주팀 행만)', !r.error && last().path.includes('member_type=eq.band'));
    r = await db(mem, 'profiles', [['delete'], ['eq', 'id', P.pend.id]]); ok('프로필 삭제 거부', !!r.error);
    r = await db(nobody, 'profiles', [['insert', [{ id: '99999999-9999-4999-8999-999999999999', kakao_id: 'spoof', name: 'n', status: 'approved', role: '운영 총괄' }]]]);
    ok('가입: 대기·일반 강제', !r.error && last().body[0].status === 'pending' && last().body[0].role === '일반' && last().body[0].kakao_id === 'k-nobody', last().body);
    r = await db(mem, 'profiles', [['insert', [{ id: '99999999-9999-4999-8999-999999999999', name: 'n' }]]]); ok('이미 가입한 사람 재가입 거부', !!r.error);
    r = await db({ sb_token: 'jwt-new' }, 'profiles', [['upsert', { id: 'spoof', member_type: 'band', status: 'approved', instruments: 'wearegathe0', band_fee: 100, band_memo: 'x' }, { onConflict: 'id' }]]);
    ok('합주팀 가입: id·아이디·상태 강제', !r.error && last().body.id === SB['jwt-new'].id && last().body.instruments === 'newteam' && last().body.status === 'pending' && !('band_memo' in last().body), last().body);
    r = await db(band, 'profiles', [['upsert', { id: P.band.id, member_type: 'band', status: 'pending' }, { onConflict: 'id' }]]); ok('승인된 팀의 가입 덮어쓰기 거부', !!r.error);
    r = await db({}, 'profiles', [['upsert', { id: P.band.id, member_type: 'band' }, { onConflict: 'id' }]]); ok('익명 합주팀 가입은 insert 만', !r.error && !last().prefer.includes('merge'), last());

    // 시간 차단
    r = await db(mem, 'time_blocks', [['delete'], ['eq', 'id', 'b1']]); ok('멤버 차단 삭제 거부', !!r.error && !log.length);
    r = await db(lead, 'time_blocks', [['insert', { reason: 'x' }]]); ok('총괄 차단 거부(운영 총괄만)', !!r.error);
    r = await db(sup, 'time_blocks', [['insert', { reason: 'x' }]]); ok('운영 총괄 차단', !r.error);
    r = await db({ session: await sess(ADMIN_KID) }, 'time_blocks', [['delete'], ['in', 'id', ['a', 'b']]]); ok('백스톱 관리자', !r.error);
    r = await db(band, 'time_blocks', [['insert', { reason: '[고정팀 대체] 반도', is_recurring: false, start_date: 'x' }], ['select', 'id'], ['single']]); ok('팀 대체 합주 차단', !r.error);
    r = await db(band, 'time_blocks', [['insert', { reason: '[고정팀] 반도', is_recurring: true }]]); ok('팀이 반복 차단 거부', !!r.error);
    r = await db(band, 'time_blocks', [['update', { skip_dates: ['2026-12-01'] }], ['eq', 'id', 'b1']]); ok('팀 건너뛰는 날 갱신', !r.error);
    r = await db(band, 'time_blocks', [['update', { end_date: '2026-01-01' }], ['eq', 'id', 'b1']]); ok('팀이 차단 종료 거부', !!r.error);
    r = await db(badmin, 'time_blocks', [['update', { end_date: '2026-01-01' }], ['eq', 'id', 'b1']]); ok('운영 계정 차단 수정', !r.error);
    const cm = { day_of_week: 2, start_time: '10:00', end_time: '12:00', reason: '[커뮤니티] 잼데이', start_date: d, end_date: d };
    r = await db({}, 'time_blocks', [['insert', cm]]); ok('모임 없는 커뮤니티 차단 거부', !!r.error);
    canned = { 'community_meetings?select=id': [{ id: 'm1' }] };
    r = await db({}, 'time_blocks', [['insert', cm]]); ok('방금 만든 모임의 차단 허용', !r.error && last().method === 'POST');
    r = await db({}, 'time_blocks', [['insert', { ...cm, end_date: future(40) }]]); ok('여러 날짜 커뮤니티 차단 거부', !!r.error);
    r = await db({}, 'time_blocks', [['delete'], ['eq', 'reason', '[커뮤니티] 잼데이'], ['eq', 'start_date', d]]); ok('모임이 남아 있으면 차단 정리 거부', !!r.error);
    canned = {};
    r = await db({}, 'time_blocks', [['delete'], ['eq', 'reason', '[커뮤니티] 잼데이'], ['eq', 'start_date', d]]); ok('삭제된 모임의 차단 정리', !r.error && last().method === 'DELETE' && last().path.includes('end_date=eq.' + d));
    r = await db({}, 'time_blocks', [['delete'], ['eq', 'reason', '[고정팀] 반도'], ['eq', 'start_date', d]]); ok('다른 차단은 익명 삭제 불가', !!r.error);

    // 공간 대관
    r = await db({}, 'performance_bookings', [['select', '*']]); ok('익명 대관 명단 거부', !!r.error && !log.length);
    r = await db(lead, 'performance_bookings', [['select', '*']]); ok('총괄 대관 명단 거부(운영 총괄만)', !!r.error);
    r = await db(sup, 'performance_bookings', [['select', '*'], ['order', 'created_at', { ascending: false }]]); ok('운영 총괄 대관 명단', !r.error);
    r = await db({}, 'performance_bookings', [['insert', { name: '고객', phone: '010-1234-5678', date: d, start_time: '10:00', end_time: '12:00', headcount: 5, status: 'approved', booking_code: 'ABC234' }], ['select', 'id,booking_code'], ['single']]);
    ok('익명 대관 신청: 상태 못 정함', !r.error && !('status' in last().body) && last().body.booking_code === 'ABC234' && r.data && r.data.id === 'new', [last().body, r]);
    r = await db({}, 'performance_bookings', [['insert', { name: '고객', phone: '010-1234-5678', date: d, start_time: '10:00', end_time: '12:00' }], ['select', '*'], ['single']]); ok('신청 응답은 id·번호만', decodeURIComponent(last().path).includes('select=id,booking_code'));
    r = await db({}, 'performance_bookings', [['insert', { name: '', phone: '1', date: d, start_time: '10:00', end_time: '12:00' }]]); ok('이름·연락처 없는 신청 거부', !!r.error);
    r = await db({}, 'performance_bookings', [['update', { status: 'approved' }], ['eq', 'id', 'p1']]); ok('익명 대관 승인 거부', !!r.error && !log.length);
    r = await db({}, 'performance_bookings', [['update', { status: 'expired' }], ['eq', 'status', 'pending'], ['lt', 'created_at', '2999-01-01']]);
    ok('만료 반영은 4시간 지난 대기만', !r.error && (last().path.match(/created_at=lt\./g) || []).length === 2 && last().path.includes('status=eq.pending'), last().path);
    r = await db(sup, 'performance_bookings', [['delete'], ['eq', 'id', 'p1']]); ok('운영 총괄 대관 삭제', !r.error);

    // 게시판·외부인
    r = await db(mem, 'comments', [['insert', [{ kakao_id: 'spoof', content: 'c' }]]]); ok('글쓴이 강제', last().body[0].kakao_id === 'k-member');
    r = await db(mem, 'comments', [['update', { content: 'x' }], ['eq', 'id', 'c1']]); ok('글 수정은 본인 것만', last().path.includes('kakao_id=eq.k-member'));
    r = await db(mem, 'comments', [['update', { likes: 3 }], ['eq', 'id', 'c1']]); ok('좋아요는 누구나', !last().path.includes('kakao_id=eq.'));
    r = await db(mem, 'comments', [['update', { pinned: true, pinned_at: 'x' }], ['eq', 'id', 'c1']]); ok('고정은 관리자만', !!r.error);
    r = await db(mgr, 'comments', [['delete'], ['eq', 'id', 'c1'], ['select']]); ok('관리자 글 삭제', !r.error && !last().path.includes('kakao_id=eq.'));
    r = await db(mem, 'schedule_guests', [['insert', { host_profile_id: 'spoof', guest_count: 2 }], ['select'], ['single']]); ok('외부인 줄 주인 강제', last().body.host_profile_id === P.member.id);
    r = await db(mem, 'schedule_guests', [['delete'], ['eq', 'id', 'g1']]); ok('외부인 줄 삭제는 본인 것', last().path.includes(`host_profile_id=eq.${P.member.id}`));

    // 두 신원(카카오 + 합주팀)
    r = await db({ ...mem, sb_token: 'jwt-badmin' }, 'time_blocks', [['delete'], ['eq', 'id', 'b1']]); ok('둘 중 통과하는 신원으로', !r.error);
    r = await db({ ...mem, sb_token: 'jwt-band', prefer: 'sb' }, 'profiles', [['select', '*']]); ok('prefer sb → 팀 본인 행', last().path.includes(`id=eq.${P.band.id}`));
    r = await db({ ...mem, sb_token: 'jwt-band' }, 'profiles', [['select', '*']]); ok('기본은 카카오 멤버', last().path.includes('member_type.neq.band'));
    r = await db({ session: 'x.y', sb_token: 'jwt-band' }, 'profiles', [['select', '*']]); ok('한쪽만 유효해도 진행', !r.error);

    // DB 오류·single
    canned = { 'notices': () => json({ message: "Could not find the 'x' column", code: 'PGRST204' }, 400) };
    r = await db(lead, 'notices', [['insert', { x: 1 }]]); ok('DB 오류 그대로 전달', r.error && r.error.code === 'PGRST204' && /column/.test(r.error.message));
    canned = { 'profiles?': [] };
    r = await db(mgr, 'profiles', [['select', '*'], ['eq', 'id', 'x'], ['single']]); ok('single 0행 → PGRST116', r.error && r.error.code === 'PGRST116');
    canned = {};
}

// ── 4. 전용 액션 ──
{
    canned = { 'performance_bookings?select=id,name': [{ id: '11111111-1111-4111-8111-111111111111', name: '고객', phone: '010-1234-5678', status: 'pending' }] };
    let [st, b] = await handle(env, { action: 'perf_lookup', code: 'abc234', phone: '01012345678' }); ok('대관 조회 일치', st === 200 && b.booking && b.booking.name === '고객');
    [st, b] = await handle(env, { action: 'perf_lookup', code: 'ABC234', phone: '01099999999' }); ok('연락처 다르면 없음', st === 200 && b.booking === null);
    [st, b] = await handle(env, { action: 'perf_lookup', code: 'AB', phone: '01012345678' }); ok('예약번호 형식', st === 400);
    log = []; canned['performance_bookings?id=eq.'] = [{ id: 'x' }];
    [st, b] = await handle(env, { action: 'perf_cancel', id: '11111111-1111-4111-8111-111111111111', phone: '010-1234-5678' });
    ok('고객 취소', st === 200 && b.cancelled === true && log.some(l => l.method === 'PATCH' && l.path.includes('status=in.(pending,approved)') && l.body.status === 'cancelled'));
    log = []; [st, b] = await handle(env, { action: 'perf_cancel', id: '11111111-1111-4111-8111-111111111111', phone: '01000000000' }); ok('남의 예약 취소 불가', !log.some(l => l.method === 'PATCH'));
    canned = { 'profiles?select=email,phone': [{ email: 'gildong@example.com', phone: '010-1111-2222' }] };
    [st, b] = await handle(env, { action: 'find_id', name: '홍길동', phone: '01011112222' }); ok('아이디 찾기는 가려서', b.masked === 'gi****@example.com', b);
    [st, b] = await handle(env, { action: 'find_id', name: '홍길동', phone: '01000000000' }); ok('불일치 null', b.masked === null);
    canned = { 'profiles?select=id,phone,member_type&name=eq.': [{ id: P.pend.id, phone: '010-3333-4444' }] };
    log = []; [st, b] = await handle(env, { action: 'kakao_link', name: '옛멤버', phone: '01033334444', session: await sess('k-nobody') });
    ok('카카오 연동', b.linked === true && log.some(l => l.method === 'PATCH' && l.body.kakao_id === 'k-nobody' && l.path.includes('kakao_id=is.null')));
    [st, b] = await handle(env, { action: 'kakao_link', name: '옛멤버', phone: '01033334444' }); ok('익명 연동 401', st === 401);
    [st, b] = await handle(env, { action: 'kakao_link', name: '옛멤버', phone: '01033334444', session: await sess('k-member') }); ok('이미 가입한 사람 연동 409', st === 409);
    // 이름+전화번호만으로는 이메일 로그인 계정에 카카오를 붙일 수 없다(계정 탈취 방지, 2026-11-23)
    canned = { 'profiles?select=id,phone,member_type&name=eq.': [{ id: P.email.id, phone: '010-3333-4444' }] };
    log = []; [st, b] = await handle(env, { action: 'kakao_link', name: '이메일멤버', phone: '01033334444', session: await sess('k-nobody') });
    ok('옛 연동: 이메일 계정은 거부(need_login)', b.ok === false && b.error === 'need_login' && !log.some(l => l.method === 'PATCH'), b);
    canned = { 'profiles?select=id,phone,member_type&name=eq.': [{ id: P.band.id, phone: '010-3333-4444', member_type: 'band' }] };
    log = []; [st, b] = await handle(env, { action: 'kakao_link', name: '팀', phone: '01033334444', session: await sess('k-nobody') });
    ok('옛 연동: 합주팀 프로필은 대상 아님', b.linked === false && !log.some(l => l.method === 'PATCH'), b);
    canned = {};
}
// ── 4b. 이메일 계정 ↔ 카카오 연결(kakao_link_self · identity_sync · 연결된 계정의 기록 키) ──
{
    let st, b;
    const patched = (t) => log.filter(l => l.method === 'PATCH' && l.path.startsWith(t));
    canned = { 'profiles?id=eq.': [{ id: P.email.id }], 'reservations?kakao_id=eq.': [{ id: 'r1' }, { id: 'r2' }], 'comments?kakao_id=eq.': [{ id: 'c1' }], 'polls?created_by=eq.': [] };
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', kakao_token: 'kt-k-nobody', sb_token: 'jwt-email' });
    ok('본인 연결: 성공', st === 200 && b.linked === true && b.kakao_id === 'k-nobody' && b.moved === 3, b);
    ok('본인 연결: 프로필에 카카오 ID(비어 있을 때만)', patched('profiles').some(l => l.path.includes(`id=eq.${P.email.id}`) && l.path.includes('kakao_id=is.null') && l.body.kakao_id === 'k-nobody'));
    ok('본인 연결: 옛 예약·글을 카카오 ID 로', patched('reservations').some(l => l.path.includes(`kakao_id=eq.${P.email.id}`) && l.body.kakao_id === 'k-nobody') && patched('comments').some(l => l.body.kakao_id === 'k-nobody') && patched('polls').some(l => l.body.created_by === 'k-nobody'));
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', session: await sess('k-nobody'), sb_token: 'jwt-email' });
    ok('본인 연결: 서버 세션으로도', st === 200 && b.linked === true);
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', sb_token: 'jwt-email' });
    ok('본인 연결: 카카오 확인 없으면 401', st === 401 && !log.some(l => l.method === 'PATCH'));
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', kakao_token: 'kt-k-nobody' });
    ok('본인 연결: 이메일 세션 없으면 401', st === 401 && !log.some(l => l.method === 'PATCH'));
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', kakao_token: 'kt-k-member', sb_token: 'jwt-email' });
    ok('본인 연결: 이미 다른 계정에 쓰인 카카오 409', st === 409 && b.error === 'kakao_taken' && !log.some(l => l.method === 'PATCH'), b);
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', kakao_token: 'kt-k-nobody', sb_token: 'jwt-linked' });
    ok('본인 연결: 이미 다른 카카오와 연결된 계정 409', st === 409 && b.error === 'linked_other' && !log.some(l => l.method === 'PATCH'), b);
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', kakao_token: 'kt-k-linked', sb_token: 'jwt-linked' });
    ok('본인 연결: 같은 카카오면 그대로 성공(프로필은 안 고침, 기록만 맞춤)', st === 200 && b.linked === true && !patched('profiles').length && patched('reservations').length === 1, b);
    log = []; [st, b] = await handle(env, { action: 'kakao_link_self', kakao_token: 'kt-k-nobody', sb_token: 'jwt-band' });
    ok('본인 연결: 합주팀 계정은 불가', st === 400 && b.error === 'not_member' && !log.some(l => l.method === 'PATCH'), b);
    log = []; [st, b] = await handle(env, { action: 'identity_sync', sb_token: 'jwt-linked' });
    ok('기록 맞추기: 연결된 계정', st === 200 && b.moved === 3 && patched('reservations').some(l => l.path.includes(`kakao_id=eq.${P.linked.id}`) && l.body.kakao_id === 'k-linked'), b);
    log = []; [st, b] = await handle(env, { action: 'identity_sync', sb_token: 'jwt-email' });
    ok('기록 맞추기: 연결 안 된 계정은 아무것도 안 함', st === 200 && b.moved === 0 && !log.some(l => l.method === 'PATCH'));
    log = []; [st, b] = await handle(env, { action: 'identity_sync', session: await sess('k-member') });
    ok('기록 맞추기: 이메일 세션 필수', st === 401);
    canned = {};
    // 연결된 계정은 이메일로 로그인해도 기록 키가 카카오 ID
    ok('연결된 이메일 세션의 uid = 카카오 ID', makeActor({ sb: { id: P.linked.id, email: 'ln@example.com' }, profile: P.linked }).uid === 'k-linked');
    ok('연결 안 된 이메일 세션의 uid = 계정 id', makeActor({ sb: { id: P.email.id, email: 'em@example.com' }, profile: P.email }).uid === P.email.id);
    ok('합주팀 계정은 kakao_id 가 있어도 계정 id', makeActor({ sb: { id: P.band.id, email: '' }, profile: { ...P.band, kakao_id: 'k-x' } }).uid === P.band.id);
    let r = await db({ sb_token: 'jwt-linked' }, 'comments', [['insert', { content: '안녕', user_name: '연결멤버', kakao_id: 'spoof' }]]);
    ok('연결된 이메일 세션의 글 작성자 = 카카오 ID', !r.error && last().body && (Array.isArray(last().body) ? last().body[0] : last().body).kakao_id === 'k-linked', last());
    r = await db({ sb_token: 'jwt-linked' }, 'comments', [['delete'], ['eq', 'id', 'c9']]);
    ok('연결된 이메일 세션의 글 삭제는 카카오 ID 로 본인 것만', last().path.includes('kakao_id=eq.k-linked'), last());
    r = await db({ sb_token: 'jwt-linked' }, 'profiles', [['update', { phone: '010-0000-0000' }], ['eq', 'id', P.linked.id]]);
    ok('연결된 이메일 세션의 본인 프로필 수정은 계정 id 로', !r.error && last().path.includes(`id=eq.${P.linked.id}`), last());
}
// ── 4c. 계정 통합(운영 총괄만) ──
{
    let st, b;
    const sup = { session: await sess('k-sup') }, mem = { session: await sess('k-member') };
    const kOnly = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kakao_id: 'k-dup', name: '이메일멤버', status: 'approved', role: '일반', created_at: '2026-11-23T00:00:00Z' };
    const kOnly2 = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', kakao_id: 'k-dup2', name: '이메일멤버', status: 'approved', role: '세션장', created_at: '2026-11-24T00:00:00Z' };
    P.kOnly = kOnly; P.kOnly2 = kOnly2;
    const rpc = () => log.filter(l => l.path.startsWith('rpc/gaa_merge_profiles'));
    log = []; [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: kOnly.id, b_id: P.email.id, ...sup });
    ok('통합 계획: 이메일 로그인 있는 쪽이 남는다(고른 순서와 무관)', st === 200 && b.dry && b.keep.id === P.email.id && b.drop.id === kOnly.id && b.keep.login === true && b.drop.login === false && b.swappable === false && !rpc().length, b);
    [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: P.email.id, b_id: kOnly.id, keep_id: kOnly.id, ...sup });
    ok('통합 계획: 로그인 있는 쪽은 운영자가 골라도 못 없앤다', b.keep.id === P.email.id && b.drop.id === kOnly.id);
    [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: kOnly.id, b_id: kOnly2.id, ...sup });
    ok('통합 계획: 둘 다 카카오면 역할 높은 쪽 + 바꿀 수 있음 + 카카오 로그인 하나가 끊긴다고 알림', b.keep.id === kOnly2.id && b.swappable === true && b.kakao_lost === true, b);
    [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: kOnly.id, b_id: kOnly2.id, keep_id: kOnly.id, ...sup });
    ok('통합 계획: 둘 다 카카오면 운영자가 고른 쪽', b.keep.id === kOnly.id && b.drop.id === kOnly2.id);
    [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: P.email.id, b_id: P.linked.id, ...sup });
    ok('통합 계획: 둘 다 이메일 로그인 → 409', st === 409 && b.error === 'both_login');
    [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: P.sup.id, b_id: kOnly.id, keep_id: kOnly.id, ...sup });
    ok('통합 계획: 로그인한 본인 계정은 없앨 수 없다', st === 400 && b.error === 'self', b);
    [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: P.band.id, b_id: kOnly.id, ...sup });
    ok('통합 계획: 합주팀 계정 불가', st === 400 && b.error === 'band');
    [st, b] = await handle(env, { action: 'profile_merge', dry: true, a_id: kOnly.id, b_id: kOnly.id, ...sup });
    ok('통합 계획: 같은 계정 400', st === 400);
    canned = { 'rpc/gaa_merge_profiles': { ok: true, keep: P.email.id, kakao_linked: true, moved: { attendees: 2 } } };
    log = []; [st, b] = await handle(env, { action: 'profile_merge', keep_id: P.email.id, drop_id: kOnly.id, ...sup });
    ok('통합 실행: DB 함수 호출(남길 id·없앨 id)', st === 200 && b.merged === true && b.kakao_linked === true && rpc().length === 1 && rpc()[0].method === 'POST' && rpc()[0].body.p_keep === P.email.id && rpc()[0].body.p_drop === kOnly.id, b);
    log = []; [st, b] = await handle(env, { action: 'profile_merge', keep_id: kOnly.id, drop_id: P.email.id, ...sup });
    ok('통합 실행: 없앨 쪽에 이메일 로그인 → 거부, DB 함수 안 부름', st === 409 && b.error === 'drop_has_login' && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_merge', keep_id: P.email.id, drop_id: kOnly.id, ...mem });
    ok('통합 실행: 일반 멤버 403', st === 403 && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_merge', keep_id: P.email.id, drop_id: kOnly.id });
    ok('통합 실행: 익명 401', st === 401 && !rpc().length);
    canned = { 'rpc/gaa_merge_profiles': () => json({ code: 'PGRST202', message: 'Could not find the function public.gaa_merge_profiles' }, 404) };
    [st, b] = await handle(env, { action: 'profile_merge', keep_id: P.email.id, drop_id: kOnly.id, ...sup });
    ok('통합 실행: DB 함수가 없으면 SQL 안내', b.ok === false && b.error === 'no_function' && /20261123_profile_merge\.sql/.test(b.message), b);
    canned = { 'rpc/gaa_merge_profiles': () => json({ code: 'P0001', message: 'MERGE_DROP_HAS_LOGIN' }, 400) };
    [st, b] = await handle(env, { action: 'profile_merge', keep_id: P.email.id, drop_id: kOnly.id, ...sup });
    ok('통합 실행: DB 가 거부한 이유를 안내', st === 409 && b.error === 'drop_has_login');
    canned = {}; delete P.kOnly; delete P.kOnly2;
}
// ── 4d. 회원 탈퇴 · 거절된 멤버 삭제 ──
{
    let st, b;
    const sup = { session: await sess('k-sup') }, mem = { session: await sess('k-member') };
    const rej = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', kakao_id: 'k-rej', name: '거절됨', status: 'rejected', role: '일반', avatar_url: 'https://sb.test/storage/v1/object/public/community-images/avatars/dddddddd-dddd-4ddd-8ddd-dddddddddddd-1700000000000.jpg' };
    const rej2 = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', kakao_id: null, name: '거절됨2', status: 'rejected', role: '일반' };
    P.rej = rej; P.rej2 = rej2;
    const rpc = () => log.filter(l => l.path.startsWith('rpc/gaa_delete_profile'));
    let outer = [];   // rest/v1 밖 요청(관리 API·스토리지)
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => { url = String(url); if ((opts.method || 'GET') === 'DELETE' && !url.includes('/rest/v1/')) { outer.push(url); return new Response('', { status: 200 }); } return realFetch(url, opts); };

    canned = { 'rpc/gaa_delete_profile': { ok: true, auth: 'deleted', done: {} } };
    log = []; outer = []; [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.member.id, ...mem });
    ok('탈퇴: 본인 프로필 → DB 함수 호출', st === 200 && b.withdrawn === true && rpc().length === 1 && rpc()[0].body.p_id === P.member.id, b);
    log = []; [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.mgr.id, ...mem });
    ok('탈퇴: 남의 프로필 id 로는 403, DB 함수 안 부름', st === 403 && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.member.id });
    ok('탈퇴: 익명 401', st === 401 && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.sup.id, ...sup });
    ok('탈퇴: 운영 총괄은 역할을 넘긴 뒤', st === 400 && b.error === 'sup' && !rpc().length, b);
    log = []; [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.band.id, sb_token: 'jwt-band' });
    ok('탈퇴: 합주팀 계정 불가', st === 400 && b.error === 'band' && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.linked.id, sb_token: 'jwt-linked' });
    ok('탈퇴: 이메일 세션 본인', st === 200 && b.withdrawn && rpc()[0].body.p_id === P.linked.id);
    canned = { 'rpc/gaa_delete_profile': { ok: true, auth: 'failed', done: {} } };
    log = []; outer = []; [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.linked.id, sb_token: 'jwt-linked' });
    ok('탈퇴: DB 가 로그인 계정을 못 지우면 관리 API 로 삭제', b.withdrawn && outer.some(u => u.endsWith('/auth/v1/admin/users/' + P.linked.id)) && b.auth_left === false, outer);
    canned = { 'rpc/gaa_delete_profile': () => json({ code: 'PGRST202', message: 'Could not find the function public.gaa_delete_profile' }, 404) };
    [st, b] = await handle(env, { action: 'profile_withdraw', profile_id: P.member.id, ...mem });
    ok('탈퇴: DB 함수가 없으면 SQL 안내', b.ok === false && b.error === 'no_function' && /20261124_profile_delete\.sql/.test(b.message), b);

    canned = { 'rpc/gaa_delete_profile': { ok: true, auth: 'none', done: {} }, 'profiles?select=*&id=in.': [rej, rej2, P.member] };
    log = []; outer = []; [st, b] = await handle(env, { action: 'profile_delete', ids: [rej.id, rej2.id, P.member.id], ...sup });
    ok('거절 삭제: 거절 상태만 삭제(승인 계정은 건너뜀)', st === 200 && b.deleted === 2 && b.skipped === 1 && rpc().map(l => l.body.p_id).sort().join() === [rej.id, rej2.id].sort().join(), b);
    ok('거절 삭제: 프로필 사진 파일도 정리', outer.some(u => u.includes('/storage/v1/object/community-images/avatars/' + rej.id + '-')), outer);
    canned = { 'rpc/gaa_delete_profile': { ok: true }, 'profiles?select=*&id=in.': [P.member] };
    log = []; [st, b] = await handle(env, { action: 'profile_delete', ids: [P.member.id], ...sup });
    ok('거절 삭제: 승인 계정만 고르면 409', st === 409 && b.error === 'not_rejected' && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_delete', ids: [rej.id], ...mem });
    ok('거절 삭제: 일반 멤버 403', st === 403 && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_delete', ids: [rej.id] });
    ok('거절 삭제: 익명 401', st === 401 && !rpc().length);
    log = []; [st, b] = await handle(env, { action: 'profile_delete', ids: ['x'], ...sup });
    ok('거절 삭제: 잘못된 id 400', st === 400 && !rpc().length);
    globalThis.fetch = realFetch; canned = {}; delete P.rej; delete P.rej2;
}
// ── 4e. 공간 이용 안내 값(출입 번호·담당자 연락처) — 승인된 게더링 멤버 읽기 · 운영 총괄 쓰기 ──
{
    let st, b;
    const sup = { session: await sess('k-sup') }, mem = { session: await sess('k-member') };
    canned = { 'band_settings?select': [{ key: 'door_1f', value: '1111*' }, { key: 'door_b1', value: '22223333*' }, { key: 'ops_contact', value: '010-1111-2222 (운영)' }, { key: 'etc', value: 'x' }] };
    log = []; [st, b] = await handle(env, { action: 'space_info' }); ok('공간 안내 값: 익명 401', st === 401 && !log.length);
    log = []; [st, b] = await handle(env, { action: 'space_info', session: await sess('k-pend') }); ok('공간 안내 값: 승인 전 멤버 403', st === 403 && !log.length);
    log = []; [st, b] = await handle(env, { action: 'space_info', sb_token: 'jwt-band' }); ok('공간 안내 값: 합주팀 계정은 이 경로 아님(403)', st === 403 && !log.length);
    log = []; [st, b] = await handle(env, { action: 'space_info', ...mem });
    ok('공간 안내 값: 멤버 읽기(정해진 키만)', st === 200 && b.settings.door_1f === '1111*' && b.settings.door_b1 === '22223333*' && b.settings.ops_contact === '010-1111-2222 (운영)' && !('etc' in b.settings) && !b.missing);
    [st, b] = await handle(env, { action: 'space_info', sb_token: 'jwt-email' }); ok('공간 안내 값: 이메일 로그인 멤버도 읽기', st === 200 && b.settings.door_1f === '1111*');
    canned = { 'band_settings?select': () => json({ message: 'no table' }, 404) };
    [st, b] = await handle(env, { action: 'space_info', ...mem }); ok('공간 안내 값: 표 없음 → 빈 값 + missing', st === 200 && b.missing === true && Object.keys(b.settings).length === 0);
    canned = {};
    log = []; [st, b] = await handle(env, { action: 'space_info_save', settings: { door_1f: '9999*' }, ...mem }); ok('공간 안내 저장: 멤버 403', st === 403 && !log.length);
    log = []; [st, b] = await handle(env, { action: 'space_info_save', settings: { door_1f: '9999*' }, session: await sess('k-lead') }); ok('공간 안내 저장: 총괄 403', st === 403 && !log.length);
    log = []; [st, b] = await handle(env, { action: 'space_info_save', settings: { door_1f: ' 9999* ', door_b1: '12345678*', sound_contact: 'x'.repeat(80), hack: 'no' }, ...sup });
    const w = last();
    ok('공간 안내 저장: 운영 총괄 upsert(4개 키만·다듬어서)', st === 200 && w.method === 'POST' && w.path === 'band_settings?on_conflict=key' && /merge-duplicates/.test(w.prefer)
        && w.body.length === 4 && w.body.map(r => r.key).join() === 'door_1f,door_b1,ops_contact,sound_contact' && w.body[0].value === '9999*' && w.body[2].value === '' && w.body[3].value.length === 60
        && b.settings.door_1f === '9999*');
    canned = { 'band_settings?on_conflict': () => json({ code: 'PGRST205', message: "Could not find the table 'public.band_settings' in the schema cache" }, 404) };
    [st, b] = await handle(env, { action: 'space_info_save', settings: {}, ...sup }); ok('공간 안내 저장: 표 없음 → no_table + SQL 파일 안내', st === 409 && b.error === 'no_table' && /20261124_band_settings\.sql/.test(b.message));
    canned = {};
}
// ── 5. 운영 도구(운영 총괄만) ──
{
    const sup = await sess('k-sup'), mem = await sess('k-member');
    let [st, b] = await handle(env, { action: 'client_errors', session: mem }); ok('오류 기록: 멤버 403', st === 403);
    [st, b] = await handle(env, { action: 'backup_table', table: 'profiles' }); ok('백업: 익명 401', st === 401);
    [st, b] = await handle(env, { action: 'backup_table', table: 'profiles', session: await sess('k-lead') }); ok('백업: 총괄 403', st === 403);
    canned = { 'client_errors?select': [{ id: 1, message: 'boom' }] };
    [st, b] = await handle(env, { action: 'client_errors', session: sup }); ok('오류 기록: 운영 총괄', st === 200 && b.rows.length === 1);
    canned = { 'client_errors?select': () => json({ message: 'no table' }, 404) };
    [st, b] = await handle(env, { action: 'client_errors', session: sup }); ok('오류 기록: 표 없음', b.missing === true);
    canned = {};
    [st, b] = await handle(env, { action: 'backup_tables', session: sup }); ok('백업 표 목록', b.tables.includes('profiles') && b.tables.includes('event_tickets') && !b.tables.includes('wappen_sessions') && !b.tables.includes('client_errors'));
    [st, b] = await handle(env, { action: 'backup_table', table: 'wappen_sessions', session: sup }); ok('백업: 목록 밖 표 400', st === 400);
    [st, b] = await handle(env, { action: 'backup_table', table: 'profiles; drop', session: sup }); ok('백업: 이상한 이름 400', st === 400);
    canned = { 'reservations?select=*&limit=1000&offset=1000': Array.from({ length: 1000 }, (_, i) => ({ id: i })) };
    log = []; [st, b] = await handle(env, { action: 'backup_table', table: 'reservations', offset: 1000, session: sup }); ok('백업: 쪽 넘김', b.rows.length === 1000 && b.more === true);
    canned = { 'band_pins?': () => json({ message: 'x' }, 404) };
    [st, b] = await handle(env, { action: 'backup_table', table: 'band_pins', session: sup }); ok('백업: 없는 표는 건너뜀', b.missing === true);
    canned = {};
}
{
    const a = makeActor({ kid: ADMIN_KID });
    ok('백스톱 ID 는 프로필 없어도 운영 총괄', a.sup && a.mgr && !a.member);
    ok('합주팀은 게더링 관리자 아님', !makeActor({ sb: { id: 'x', email: '' }, profile: { status: 'approved', member_type: 'band', role: '운영 총괄' } }).mgr);
    ok('승인 전 운영 계정 표식은 무효', !makeActor({ sb: { id: 'x', email: '' }, profile: { status: 'pending', member_type: 'band', instruments: 'wearegatheo' } }).bandAdmin);
}
console.log(`${pass + fail}개 중 ${pass} 통과`);
process.exit(fail ? 1 : 0);
