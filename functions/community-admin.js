// Cloudflare Pages Function: /community-admin
// 커뮤니티 모임의 운영진 작업 (service role). community_meetings 는 anon UPDATE 가 회수돼 있어
// (20260708_community_enforcement.sql) 상태 변경은 이 함수만 할 수 있다.
//
// 액션
//   review_meeting {meeting_id, decision:'approved'|'rejected', kakao_token? | sb_token?}
//     모임장이 게더링이 막아 둔 시간(time_blocks)을 골라 status='pending' 으로 만든 모임을 수락/거절.
//     수락: status→'active' + time_blocks 1행(모임 시간, 사유 '[커뮤니티] 제목') — 모임이 목록에 공개되고 시간표에 잡힌다.
//     거절: status→'rejected'. 둘 다 reviewed_at 기록, 모임장 이메일 안내(RESEND_API_KEY 있을 때만, 실패해도 처리 결과는 유지).
//
// 관리자 인증 (둘 중 하나)
//   kakao_token : 카카오 access token → kapi.kakao.com 검증 → ADMIN_KAKAO_ID 백스톱 또는 profiles.kakao_id 의 role '운영 총괄'
//   sb_token    : Supabase 세션 토큰 → /auth/v1/user → profiles.id 의 role '운영 총괄' (이메일 로그인 관리자)
//
// 에러 규약: { ok:false, error:'<기계코드>', message:'<사용자 문구>' }
//   400 형식 / 401 인증 실패 / 403 출처·권한 / 404 없음 / 409 대기 상태 아님 / 500 DB·서버
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY(선택), RESEND_FROM(선택)
// 사전 준비(1회, SQL Editor): supabase/migrations/20261013_community_meeting_status.sql
import '../shared/rules.js';

const ADMIN_KAKAO_ID = '4883868250'; // index.html ADMIN_ID / event-api·wappen-api 와 동일 — 관리자 백스톱
const ADMIN_ROLES = ['운영 총괄'];
const TIMES = globalThis.GAA_RULES.TIMES; // 08:00~22:00 (종전 사본은 10:00~ 로 낡아 있었다)
const SITE = 'https://gatherallaround.com';

function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }
const isOurHost = (h) => h === 'gatherallaround.com' || h === 'localhost' || h === '127.0.0.1' || /\.(gatherallaround\.com|pages\.dev)$/.test(h);

function corsFor(origin) {
    const host = hostOf(origin);
    const allowed = origin && (
        origin === 'https://gatherallaround.com' ||
        origin === 'https://www.gatherallaround.com' ||
        /\.(pages\.dev|gatherallaround\.com)$/.test(host)
    );
    return {
        'Access-Control-Allow-Origin': allowed ? origin : 'https://gatherallaround.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}

// 우리 사이트에서 온 요청인가 (wappen-api·music-search 와 동일 규칙)
function fromOurSite(request) {
    const sfs = request.headers.get('Sec-Fetch-Site');
    if (sfs === 'same-origin' || sfs === 'same-site') return true;
    return isOurHost(hostOf(request.headers.get('Origin') || '')) || isOurHost(hostOf(request.headers.get('Referer') || ''));
}

function sbFetch(env, pathQuery, opts = {}) {
    return fetch(`${env.SUPABASE_URL}/rest/v1/${pathQuery}`, {
        ...opts,
        headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
}

const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 카카오 access token → 카카오 ID (event-api.js verifyKakao 와 동일)
async function verifyKakao(token) {
    if (!token || typeof token !== 'string' || token.length > 512) return null;
    try {
        const r = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        return u && u.id ? String(u.id) : null;
    } catch (_) { return null; }
}

// Supabase 세션 토큰 → auth user id (send-reminders.js verifySb 와 동일)
async function verifySb(env, jwt) {
    if (!jwt || typeof jwt !== 'string' || jwt.length > 4096) return null;
    try {
        const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + jwt } });
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        return u && u.id ? String(u.id) : null;
    } catch (_) { return null; }
}

async function roleOf(env, filter) {
    const r = await sbFetch(env, `profiles?${filter}&select=role&limit=1`);
    if (!r.ok) return null;
    const [p] = await r.json().catch(() => []);
    return p ? String(p.role || '') : null;
}

// 관리자 판정 — { ok:true, who } | { ok:false, status:401|403 }
export async function resolveAdmin(env, body) {
    if (body.kakao_token) {
        const id = await verifyKakao(body.kakao_token);
        if (!id) return { ok: false, status: 401 };
        if (id === ADMIN_KAKAO_ID) return { ok: true, who: 'kakao:' + id };
        const role = await roleOf(env, `kakao_id=eq.${encodeURIComponent(id)}`);
        return ADMIN_ROLES.includes(role) ? { ok: true, who: 'kakao:' + id } : { ok: false, status: 403 };
    }
    if (body.sb_token) {
        const uid = await verifySb(env, body.sb_token);
        if (!uid || !isUuid(uid)) return { ok: false, status: 401 };
        const role = await roleOf(env, `id=eq.${uid}`);
        return ADMIN_ROLES.includes(role) ? { ok: true, who: 'sb:' + uid } : { ok: false, status: 403 };
    }
    return { ok: false, status: 401 };
}

// meeting_time "10:00 ~ 13:00" (끝은 표시용 '다음 슬롯') → [시작 슬롯, 끝 슬롯] (index.html submitCommunityCreate 의 역변환)
export function meetingSlots(meetingTime) {
    const m = String(meetingTime || '').match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/);
    if (!m) return null;
    const s = TIMES.indexOf(m[1]);
    const e = m[2] === '23:00' ? TIMES.length - 1 : TIMES.indexOf(m[2]) - 1;
    return s < 0 || e < 0 || e < s ? null : [s, e];
}

// 모임장 이메일 안내 — 키 없거나 주소 없으면 조용히 건너뜀 (처리 결과에는 영향 없음)
async function notifyOrganizer(env, m, decision) {
    if (!env.RESEND_API_KEY) return false;
    const to = String(m.organizer_email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;
    const ok = decision === 'approved';
    const when = `${String(m.meeting_date || '').replace(/-/g, '.')} ${m.meeting_time || ''}`.trim();
    const subject = `[게더 올 어라운드] "${m.title}" 모임 시간 요청이 ${ok ? '수락' : '거절'}되었습니다`;
    const link = `${SITE}/meet/${m.id}`; // 경로형 공유 주소 — 메일 앱 인앱 브라우저가 #해시를 버려도 상세로(functions/meet/[id].js)
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;line-height:1.7">
        <h2 style="font-size:1.1rem;margin:0 0 12px">${ok ? '모임 시간 요청이 수락되었습니다 🎉' : '모임 시간 요청이 거절되었습니다'}</h2>
        <p style="margin:0 0 12px">${esc(m.organizer_name || '모임장')}님, 게더 올 어라운드 공간에서 <b>${esc(m.title)}</b> 모임을 ${ok ? '진행하실 수 있습니다.' : '진행하기 어렵게 되었습니다.'}</p>
        <table style="border-collapse:collapse;font-size:0.92rem"><tr><td style="padding:4px 12px 4px 0;color:#888">모임</td><td>${esc(m.title)}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">일시</td><td>${esc(when)}</td></tr></table>
        ${ok ? `<p style="margin:14px 0 0">모임이 커뮤니티 목록에 공개되었고 공간 시간표에도 잡혔습니다.<br><a href="${link}" style="color:#3366ff">${link}</a></p>`
             : `<p style="margin:14px 0 0">선택하신 시간은 게더링이 사용 중인 시간이라 열어드리기 어렵습니다. 다른 시간으로 다시 만들어 주시거나, 문의가 필요하면 이 메일에 답장해 주세요.</p>`}
        <p style="margin:18px 0 0;font-size:0.8rem;color:#999">게더 올 어라운드 · ${SITE}</p></div>`;
    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.RESEND_FROM || 'noreply@gatherallaround.com', to, subject, html }),
        });
        return r.ok;
    } catch (_) { return false; }
}

// ───────── 모임 신청자 명단(community_applications) — 2026-11-10 ─────────
// 이름·연락처가 든 표라 공개 키(anon)로는 읽고 쓸 수 없게 잠그고(20261110_community_applications_lockdown.sql) 전부 여기를 거친다.
//   app_counts  {meeting_ids[]}                 → { counts:{모임:신청 수(거절 제외)} }            누구나
//   app_public  {meeting_id}                    → { rows:[{status, form_data(선택형 답만)}] }      누구나 — 이름·연락처 없음(정원·선택지 마감 계산용)
//   app_apply   {meeting_id, name, phone, email?, form_data} → { id } | 409 dup                     누구나
//   app_mine    {name, phone}                   → { rows } 이름+연락처가 모두 맞는 내 신청          누구나
//   app_cancel  {app_id, phone}                 → { cancelled }                                    본인(연락처 일치)
//   app_auth    {meeting_id, pw}                → { token, exp } 모임장·마스터 비밀번호 확인 → 2시간 토큰
//   app_list    {meeting_id, token}             → { rows } 전체 명단                               모임장
//   app_status  {meeting_id, app_id, token, status}  /  app_delete {meeting_id, app_id, token}     모임장
//   app_open_switch {meeting_id, token[, prev_title]} → { switched, blocks_removed } 날짜·시간 해지(상시 모집) + 시간표 차단 삭제  모임장
const digits = (v) => String(v || '').replace(/\D/g, '');
const enc = encodeURIComponent;
const ORG_TOKEN_MS = 2 * 60 * 60 * 1000;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function orgKey(env) {
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('community-organizer:v1:' + env.SUPABASE_SERVICE_ROLE_KEY));
    return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
export async function signOrganizer(env, meetingId, now = Date.now()) {
    const exp = now + ORG_TOKEN_MS;
    const sig = b64u(await crypto.subtle.sign('HMAC', await orgKey(env), new TextEncoder().encode(`${meetingId}.${exp}`)));
    return { token: `${exp}.${sig}`, exp };
}
export async function verifyOrganizer(env, meetingId, token, now = Date.now()) {
    if (!token || typeof token !== 'string' || token.length > 200 || !isUuid(meetingId)) return false;
    const [exp, sig] = token.split('.');
    if (!(Number(exp) > now) || !sig) return false;
    const want = b64u(await crypto.subtle.sign('HMAC', await orgKey(env), new TextEncoder().encode(`${meetingId}.${exp}`)));
    if (want.length !== sig.length) return false;
    let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
}
// 비밀번호 확인 — 화면(checkCommunityOrganizer)과 같은 순서: 모임별 비밀번호 → 마스터 비밀번호. DB RPC 가 있으면 먼저 쓴다.
async function organizerPwOk(env, meetingId, pw) {
    if (!pw || typeof pw !== 'string' || pw.length > 200) return false;
    try {
        const r = await sbFetch(env, 'rpc/community_can_edit', { method: 'POST', body: JSON.stringify({ p_id: meetingId, p_pw: pw }) });
        if (r.ok && (await r.json().catch(() => false)) === true) return true;
    } catch (_) {}
    const edge = async (fn, payload) => {
        try {
            const r = await fetch(`${env.SUPABASE_URL}/functions/v1/${fn}`, { method: 'POST',
                headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!r.ok) return false;
            const j = await r.json().catch(() => null);
            return !!(j && j.ok);
        } catch (_) { return false; }
    };
    if (await edge('verify-meeting-password', { meetingId, password: pw })) return true;
    return edge('verify-community-admin', { password: pw });
}
const rowsOf = async (r) => (r.ok ? ((await r.json().catch(() => [])) || []) : null);
const optionLabels = (fields) => (Array.isArray(fields) ? fields : []).filter(f => f && (f.type === 'select' || f.type === 'multi')).map(f => String(f.label));

export async function handleApplications(env, body) {
    const action = body.action, bad = (m = '요청 형식이 올바르지 않습니다.') => [400, { ok: false, error: 'bad_request', message: m }];
    if (action === 'app_counts') {
        const ids = (Array.isArray(body.meeting_ids) ? body.meeting_ids : []).filter(isUuid).slice(0, 300);
        if (!ids.length) return [200, { ok: true, counts: {} }];
        let rows = await rowsOf(await sbFetch(env, `community_applications?select=meeting_id,status&meeting_id=in.(${ids.join(',')})`));
        if (rows === null) rows = await rowsOf(await sbFetch(env, `community_applications?select=meeting_id&meeting_id=in.(${ids.join(',')})`)) || []; // status 컬럼 이전
        const counts = {};
        rows.forEach(a => { if ((a.status || 'pending') !== 'rejected') counts[a.meeting_id] = (counts[a.meeting_id] || 0) + 1; });
        return [200, { ok: true, counts }];
    }
    if (action === 'app_mine') {
        const name = String(body.name || '').trim(), phone = digits(body.phone);
        if (!name || phone.length < 10) return bad('이름과 연락처를 정확히 입력해주세요.');
        const rows = await rowsOf(await sbFetch(env, `community_applications?select=*&applicant_name=eq.${enc(name)}&order=created_at.desc&limit=200`));
        if (rows === null) return [500, { ok: false, error: 'db', message: '조회 중 오류가 발생했습니다.' }];
        return [200, { ok: true, rows: rows.filter(a => digits(a.applicant_phone) === phone) }]; // 연락처까지 맞아야 — 이름만으로는 내보내지 않는다
    }
    if (action === 'app_cancel') {
        const phone = digits(body.phone);
        if (!isUuid(body.app_id) || phone.length < 10) return bad();
        const [a] = (await rowsOf(await sbFetch(env, `community_applications?id=eq.${body.app_id}&select=id,applicant_phone&limit=1`))) || [];
        if (!a || digits(a.applicant_phone) !== phone) return [200, { ok: true, cancelled: false }];
        const d = await sbFetch(env, `community_applications?id=eq.${a.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        return d.ok ? [200, { ok: true, cancelled: true }] : [500, { ok: false, error: 'db', message: '취소하지 못했습니다.' }];
    }

    if (!isUuid(body.meeting_id)) return bad();
    const mid = body.meeting_id;
    if (action === 'app_auth') {
        if (!(await organizerPwOk(env, mid, body.pw))) return [403, { ok: false, error: 'forbidden', message: '비밀번호가 틀렸습니다.' }];
        return [200, { ok: true, ...(await signOrganizer(env, mid)) }];
    }
    if (action === 'app_public' || action === 'app_apply') {
        const [m] = (await rowsOf(await sbFetch(env, `community_meetings?id=eq.${mid}&select=id,form_fields&limit=1`))) || [];
        if (!m) return [404, { ok: false, error: 'not_found', message: '모임 정보를 찾을 수 없습니다.' }];
        let apps = await rowsOf(await sbFetch(env, `community_applications?select=id,applicant_phone,status,form_data&meeting_id=eq.${mid}`));
        if (apps === null) apps = (await rowsOf(await sbFetch(env, `community_applications?select=id,applicant_phone,form_data&meeting_id=eq.${mid}`))) || [];
        const keep = optionLabels(m.form_fields);
        const slim = (a) => { const fd = {}; const src = a.form_data && typeof a.form_data === 'object' ? a.form_data : {}; keep.forEach(k => { if (k in src) fd[k] = src[k]; }); return { status: a.status || 'pending', form_data: fd }; };
        if (action === 'app_public') return [200, { ok: true, rows: apps.map(slim) }];
        const name = String(body.name || '').trim().slice(0, 60), phoneRaw = String(body.phone || '').trim().slice(0, 30), phone = digits(phoneRaw);
        if (!name || phone.length < 9) return bad('이름과 연락처를 확인해주세요.');
        if (apps.some(a => digits(a.applicant_phone) === phone)) return [409, { ok: false, error: 'dup', message: '이미 신청하셨습니다.', rows: apps.map(slim) }];
        const fd = body.form_data && typeof body.form_data === 'object' && !Array.isArray(body.form_data) ? body.form_data : {};
        if (JSON.stringify(fd).length > 20000) return bad('답변이 너무 깁니다.');
        const email = String(body.email || '').trim().slice(0, 120) || null;
        const ins = await sbFetch(env, 'community_applications?select=id', { method: 'POST', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ meeting_id: mid, applicant_name: name, applicant_email: email, applicant_phone: phoneRaw, form_data: fd }) });
        if (!ins.ok) {
            const e = await ins.json().catch(() => ({}));
            if (e.code === '23505') return [409, { ok: false, error: 'dup', message: '이미 신청하셨습니다.' }];
            return [500, { ok: false, error: 'db', message: '신청하지 못했습니다. 잠시 후 다시 시도해주세요.' }];
        }
        const [row] = await ins.json().catch(() => []);
        return [200, { ok: true, id: row && row.id }];
    }
    // 이하 모임장 전용
    if (!['app_list', 'app_status', 'app_delete', 'app_open_switch'].includes(action)) return [400, { ok: false, error: 'bad_action', message: '지원하지 않는 요청입니다.' }];
    if (!(await verifyOrganizer(env, mid, body.token))) return [401, { ok: false, error: 'auth', message: '모임장 인증이 만료되었습니다. 비밀번호를 다시 입력해주세요.' }];
    if (action === 'app_list') {
        const rows = await rowsOf(await sbFetch(env, `community_applications?select=*&meeting_id=eq.${mid}&order=created_at.asc`));
        return rows === null ? [500, { ok: false, error: 'db', message: '명단을 불러오지 못했습니다.' }] : [200, { ok: true, rows }];
    }
    if (action === 'app_open_switch') {
        // 날짜 지정 모임 → 상시 모집: 날짜·시간을 비우고, 그 모임이 잡아 둔 1회 시간표 차단을 지운다(DB 함수에 의존하지 않음)
        const cur = await rowsOf(await sbFetch(env, `community_meetings?id=eq.${mid}&select=id,title,meeting_date`));
        if (cur === null) return [500, { ok: false, error: 'db', message: '모임을 불러오지 못했습니다.' }];
        if (!cur.length) return [404, { ok: false, error: 'not_found', message: '모임을 찾을 수 없습니다.' }];
        const m = cur[0];
        if (!m.meeting_date) return [200, { ok: true, already: true }];
        const r = await sbFetch(env, `community_meetings?id=eq.${mid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ meeting_date: null, meeting_time: null }) });
        if (!r.ok) {
            const t = await r.text().catch(() => '');
            const nn = /23502|null value|not-null/i.test(t);
            return [nn ? 409 : 500, { ok: false, error: nn ? 'not_null' : 'db', message: nn ? '날짜 칸이 필수로 묶여 있습니다. 관리자가 supabase/migrations/20261111_community_open_meetings.sql 을 실행해야 합니다.' : '전환하지 못했습니다.' }];
        }
        let block = 0;
        const titles = [...new Set([m.title, body.prev_title].filter(x => typeof x === 'string' && x && x.length <= 200))];
        for (const t of titles) {
            const d = await sbFetch(env, `time_blocks?reason=eq.${enc('[커뮤니티] ' + t)}&start_date=eq.${enc(m.meeting_date)}&end_date=eq.${enc(m.meeting_date)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
            if (d.ok) block += ((await d.json().catch(() => [])) || []).length;
        }
        return [200, { ok: true, switched: true, blocks_removed: block }];
    }
    if (!isUuid(body.app_id)) return bad();
    const target = `community_applications?id=eq.${body.app_id}&meeting_id=eq.${mid}&select=id`; // 이 모임의 신청만
    if (action === 'app_status') {
        if (!['accepted', 'rejected', 'pending'].includes(body.status)) return bad();
        const r = await sbFetch(env, target, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: body.status }) });
        if (!r.ok) return [500, { ok: false, error: 'db', message: '처리하지 못했습니다. (status 컬럼 마이그레이션 확인)' }];
        return [200, { ok: true, changed: ((await r.json().catch(() => [])) || []).length }];
    }
    const r = await sbFetch(env, target, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    return r.ok ? [200, { ok: true, changed: ((await r.json().catch(() => [])) || []).length }] : [500, { ok: false, error: 'db', message: '삭제하지 못했습니다.' }];
}

export async function onRequest(context) {
    const { request, env } = context;
    const cors = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    const fail = (status, error, message) => json({ ok: false, error, message }, status);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors });
    if (!fromOurSite(request)) return fail(403, 'origin', '허용되지 않은 출처입니다.');
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(500, 'env', '서버 설정이 없습니다.');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail(400, 'bad_json', '요청 본문이 올바르지 않습니다.');

    try {
        if (String(body.action || '').startsWith('app_')) {
            const [status, obj] = await handleApplications(env, body);
            return json(obj, status);
        }
        if (body.action === 'review_meeting') {
            const decision = String(body.decision || '');
            if (!isUuid(body.meeting_id) || !['approved', 'rejected'].includes(decision)) return fail(400, 'bad_request', '요청 형식이 올바르지 않습니다.');
            const admin = await resolveAdmin(env, body);
            if (!admin.ok) {
                return admin.status === 403 ? fail(403, 'forbidden', '운영 총괄만 처리할 수 있습니다.')
                    : fail(401, 'auth', '관리자 인증에 실패했습니다. 다시 로그인한 뒤 시도해주세요.');
            }
            const mr = await sbFetch(env, `community_meetings?id=eq.${body.meeting_id}&select=id,title,meeting_date,meeting_time,organizer_name,organizer_email,status&limit=1`);
            if (!mr.ok) return fail(500, 'db', '모임을 조회하지 못했습니다. (status 컬럼 마이그레이션 확인)');
            const [m] = await mr.json().catch(() => []);
            if (!m) return fail(404, 'not_found', '모임을 찾을 수 없습니다.');
            if (m.status !== 'pending') return fail(409, 'not_pending', '이미 처리된 요청입니다.');

            // 대기 상태인 행만 바꾼다 — 두 관리자가 동시에 눌러도 한 번만 처리(0행이면 409)
            const nextStatus = decision === 'approved' ? 'active' : 'rejected';
            const pr = await sbFetch(env, `community_meetings?id=eq.${m.id}&status=eq.pending`, {
                method: 'PATCH', headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ status: nextStatus, reviewed_at: new Date().toISOString() }) });
            if (!pr.ok) return fail(500, 'db', '상태를 바꾸지 못했습니다.');
            if (!(await pr.json().catch(() => [])).length) return fail(409, 'not_pending', '이미 처리된 요청입니다.');

            // 수락 → 시간표(time_blocks)에 모임 시간을 잡는다 (일반 생성 흐름과 같은 행). 실패해도 수락은 유지 — 관리자가 시간표에서 손으로 넣을 수 있다.
            let timeBlock = false;
            if (decision === 'approved') {
                const slots = meetingSlots(m.meeting_time);
                if (slots && /^\d{4}-\d{2}-\d{2}$/.test(String(m.meeting_date || ''))) {
                    const row = {
                        day_of_week: new Date(m.meeting_date + 'T00:00:00Z').getUTCDay(),
                        start_time: TIMES[slots[0]], end_time: TIMES[slots[1]],
                        reason: `[커뮤니티] ${m.title}`, start_date: m.meeting_date, end_date: m.meeting_date,
                    };
                    const br = await sbFetch(env, 'time_blocks', { method: 'POST', body: JSON.stringify(row) });
                    timeBlock = br.ok;
                }
            }
            const emailed = await notifyOrganizer(env, m, decision);
            return json({ ok: true, status: nextStatus, time_block: timeBlock, emailed, by: admin.who });
        }
        return fail(400, 'bad_action', '알 수 없는 요청입니다.');
    } catch (e) {
        return fail(500, 'server', String(e && e.message || e));
    }
}
