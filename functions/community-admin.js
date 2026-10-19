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

const ADMIN_KAKAO_ID = '4883868250'; // index.html ADMIN_ID / event-api·wappen-api 와 동일 — 관리자 백스톱
const ADMIN_ROLES = ['운영 총괄'];
const TIMES = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
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
    const link = `${SITE}/#community/meeting/${m.id}`;
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
