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
};
const SB = { 'jwt-band': { id: P.band.id, email: 'vandor@band.gatheo.kr' }, 'jwt-badmin': { id: P.badmin.id, email: 'wearegatheo@band.gatheo.kr' }, 'jwt-new': { id: '88888888-8888-4888-8888-888888888888', email: 'newteam@band.gatheo.kr' } };
let log = [], canned = {};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith('https://kapi.kakao.com')) { const t = (opts.headers.Authorization || '').slice(7); return t.startsWith('kt-') ? json({ id: t.slice(3) }) : json({}, 401); }
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
    canned = { 'profiles?select=id,phone&name=eq.': [{ id: P.pend.id, phone: '010-3333-4444' }] };
    log = []; [st, b] = await handle(env, { action: 'kakao_link', name: '옛멤버', phone: '01033334444', session: await sess('k-nobody') });
    ok('카카오 연동', b.linked === true && log.some(l => l.method === 'PATCH' && l.body.kakao_id === 'k-nobody' && l.path.includes('kakao_id=is.null')));
    [st, b] = await handle(env, { action: 'kakao_link', name: '옛멤버', phone: '01033334444' }); ok('익명 연동 401', st === 401);
    [st, b] = await handle(env, { action: 'kakao_link', name: '옛멤버', phone: '01033334444', session: await sess('k-member') }); ok('이미 가입한 사람 연동 409', st === 409);
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
