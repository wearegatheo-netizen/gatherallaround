// Cloudflare Pages Function: /event-api
// 공연 티켓 예매 플랫폼의 유일한 쓰기 경로 (service role).
// 클라이언트(anon)는 events/event_seats 읽기만 가능 — RLS가 나머지를 전면 차단하므로
// 예매·취소·호스트 작업은 전부 이 함수를 거친다.
//
// 에러 응답 규약: { ok:false, error:'<기계코드>', message:'<사용자 문구>' }
//   400 형식 오류 / 401 카카오 토큰 무효 / 403 소유권 없음 / 404 없음
//   409 상태 충돌(sold_out, duplicate, not_cancellable …) / 502 upstream
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (기존 /send-sms, /notify-admins와 공유)

function corsFor(origin) {
    const host = (() => { try { return new URL(origin).hostname; } catch { return ''; } })();
    const allowed = origin && (
        origin === 'https://gatherallaround.co.kr' ||
        origin === 'https://www.gatherallaround.co.kr' ||
        /\.(pages\.dev|gatherallaround\.co\.kr)$/.test(host)
    );
    return {
        'Access-Control-Allow-Origin': allowed ? origin : 'https://gatherallaround.co.kr',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}

// 예매번호: 혼동 문자(I/L/O/0/1) 제외 31자 × 6자리
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => {
    const b = crypto.getRandomValues(new Uint8Array(6));
    return [...b].map(x => CODE_CHARS[x % CODE_CHARS.length]).join('');
};
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const normPhone = v => {
    const d = String(v || '').replace(/\D/g, '');
    return /^01[016789][0-9]{7,8}$/.test(d) ? d : null;
};
const normCode = v => {
    const c = String(v || '').trim().toUpperCase();
    return /^[A-HJ-NP-Z2-9]{6}$/.test(c) ? c : null;
};

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

// 티켓을 code로 찾아 전화번호를 대조. 코드 존재 여부를 노출하지 않도록
// "코드 없음"과 "전화 불일치"는 동일한 null(→404)로 처리한다.
async function findTicketByCodePhone(env, code, phone) {
    const sel = '*,events(id,title,host_name,venue,starts_at,price,bank_info,status)';
    const r = await sbFetch(env, `event_tickets?code=eq.${code}&select=${encodeURIComponent(sel)}&limit=1`);
    if (!r.ok) throw new Error('ticket lookup failed: ' + r.status);
    const [t] = await r.json();
    if (!t || t.buyer_phone !== phone) return null;
    return t;
}

// ── 호스트 인증 — 카카오 access token을 카카오 서버에서 직접 검증 ──
// 이 사이트의 카카오 로그인은 Supabase auth 없이 동작하므로, 서버가 신뢰할 수 있는
// 유일한 근거는 카카오 API가 토큰 주인의 id를 확인해주는 것뿐이다.
const ADMIN_KAKAO_ID = '4883868250'; // index.html ADMIN_ID와 동일 — 전체 관리 백스톱

async function verifyKakao(token) {
    if (!token || typeof token !== 'string' || token.length > 512) return null;
    try {
        const r = await fetch('https://kapi.kakao.com/v2/user/me', {
            headers: { Authorization: 'Bearer ' + token },
        });
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        if (!u || !u.id) return null;
        const nickname = (u.kakao_account && u.kakao_account.profile && u.kakao_account.profile.nickname)
            || (u.properties && u.properties.nickname) || '';
        return { id: String(u.id), nickname };
    } catch (_) { return null; }
}

// 내가 속한 팀 목록 (멤버십 join)
async function getMyTeams(env, kakaoId) {
    const sel = 'role,event_hosts(*)';
    const r = await sbFetch(env, `event_host_members?kakao_id=eq.${encodeURIComponent(kakaoId)}&select=${encodeURIComponent(sel)}&order=created_at.asc`);
    if (!r.ok) throw new Error('teams lookup failed: ' + r.status);
    return (await r.json()).filter(m => m.event_hosts).map(m => ({ ...m.event_hosts, my_role: m.role }));
}

// 팀 멤버십 확인 — 멤버 행(role 포함) 또는 null
async function getMembership(env, hostId, kakaoId) {
    const r = await sbFetch(env, `event_host_members?host_id=eq.${hostId}&kakao_id=eq.${encodeURIComponent(kakaoId)}&select=role&limit=1`);
    if (!r.ok) throw new Error('membership lookup failed: ' + r.status);
    const [m] = await r.json();
    return m || null;
}

// 공연 소유권 확인 — 해당 팀의 멤버(공동호스트 포함)이거나 ADMIN.
// 반환: { ev } 또는 { err: [status, code, msg] }
async function getEventOwned(env, eventId, kakaoId) {
    if (!isUuid(eventId)) return { err: [400, 'bad_event', '공연 정보가 올바르지 않습니다.'] };
    const r = await sbFetch(env, `events?id=eq.${eventId}&select=*&limit=1`);
    if (!r.ok) return { err: [502, 'db', '공연 조회에 실패했습니다.'] };
    const [ev] = await r.json();
    if (!ev) return { err: [404, 'not_found', '공연을 찾을 수 없습니다.'] };
    if (kakaoId !== ADMIN_KAKAO_ID) {
        const m = await getMembership(env, ev.host_id, kakaoId);
        if (!m) return { err: [403, 'not_owner', '이 공연을 관리할 권한이 없습니다.'] };
    }
    return { ev };
}

// 티켓 소유권 확인 (티켓 → 공연 → 팀 멤버십 역추적)
async function getTicketOwned(env, ticketId, kakaoId) {
    if (!isUuid(ticketId)) return { err: [400, 'bad_ticket', '티켓 정보가 올바르지 않습니다.'] };
    const sel = '*,events(id,title,starts_at,price,host_id)';
    const r = await sbFetch(env, `event_tickets?id=eq.${ticketId}&select=${encodeURIComponent(sel)}&limit=1`);
    if (!r.ok) return { err: [502, 'db', '티켓 조회에 실패했습니다.'] };
    const [t] = await r.json();
    if (!t) return { err: [404, 'not_found', '티켓을 찾을 수 없습니다.'] };
    if (kakaoId !== ADMIN_KAKAO_ID) {
        const m = t.events ? await getMembership(env, t.events.host_id, kakaoId) : null;
        if (!m) return { err: [403, 'not_owner', '이 티켓을 관리할 권한이 없습니다.'] };
    }
    return { t };
}

const newToken = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};

// 공연 필드 검증 (create/update 공용). partial=true면 존재하는 필드만 검증.
function validateEventFields(e, { partial = false } = {}) {
    const out = {}, bad = (m) => ({ error: m });
    const has = (k) => e[k] !== undefined && e[k] !== null;
    if (has('title') || !partial) {
        const v = String(e.title || '').trim();
        if (!v || v.length > 80) return bad('공연명을 확인해주세요. (80자 이내)');
        out.title = v;
    }
    if (has('venue') || !partial) {
        const v = String(e.venue || '게더 올 어라운드 (신촌)').trim();
        if (!v || v.length > 120) return bad('장소를 확인해주세요.');
        out.venue = v;
    }
    if (has('starts_at') || !partial) {
        const d = new Date(e.starts_at);
        if (isNaN(d)) return bad('공연 일시를 확인해주세요.');
        if (!partial && d <= new Date()) return bad('공연 일시는 미래여야 합니다.');
        out.starts_at = d.toISOString();
    }
    if (has('capacity') || !partial) {
        const v = parseInt(e.capacity, 10);
        if (!Number.isInteger(v) || v < 1 || v > 1000) return bad('정원은 1~1000명 사이여야 합니다.');
        out.capacity = v;
    }
    if (has('price') || !partial) {
        const v = parseInt(e.price, 10) || 0;
        if (v < 0 || v > 1000000) return bad('티켓 가격을 확인해주세요.');
        out.price = v;
    }
    if (has('max_per_booking') || !partial) {
        const v = parseInt(e.max_per_booking, 10) || 4;
        if (v < 1 || v > 10) return bad('1인 최대 매수는 1~10 사이여야 합니다.');
        out.max_per_booking = v;
    }
    if (has('description')) out.description = String(e.description || '').slice(0, 12000);
    if (has('bank_info')) out.bank_info = String(e.bank_info || '').trim().slice(0, 120) || null;
    if (e.venue_address !== undefined) out.venue_address = String(e.venue_address || '').trim().slice(0, 200) || null;
    if (e.venue_lat !== undefined || e.venue_lng !== undefined) {
        const lat = (e.venue_lat === null || e.venue_lat === undefined || e.venue_lat === '') ? null : Number(e.venue_lat);
        const lng = (e.venue_lng === null || e.venue_lng === undefined || e.venue_lng === '') ? null : Number(e.venue_lng);
        if (lat === null && lng === null) { out.venue_lat = null; out.venue_lng = null; }
        else if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return bad('장소 좌표가 올바르지 않습니다.');
        } else { out.venue_lat = lat; out.venue_lng = lng; }
    }
    return { fields: out };
}

const BOOK_ERR = {
    not_found: [404, '공연을 찾을 수 없습니다.'],
    closed:    [409, '예매가 마감된 공연입니다.'],
    started:   [409, '이미 시작된 공연입니다.'],
    bad_qty:   [400, '예매 가능한 매수를 초과했습니다.'],
    duplicate: [409, '이미 이 공연에 예매된 전화번호입니다. "내 티켓 조회"에서 확인해주세요.'],
};

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    const fail = (status, error, message) => json({ ok: false, error, message }, status);

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // GET: 셀프 진단 (PII 없음)
    if (request.method === 'GET') {
        const out = { 시각: new Date().toISOString() };
        try {
            out.환경변수_SUPABASE = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
            if (out.환경변수_SUPABASE) {
                const ev = await sbFetch(env, 'events?select=id&limit=1');
                out.events_테이블 = ev.ok;
                if (!ev.ok) out.events_오류 = (await ev.text().catch(() => '')).slice(0, 200);
                const tk = await sbFetch(env, 'event_tickets?select=id&limit=1');
                out.event_tickets_테이블 = tk.ok;
                // 존재하지 않는 uuid로 RPC 존재 여부만 확인 (부작용 없음)
                const rpc = await sbFetch(env, 'rpc/book_event_ticket', {
                    method: 'POST',
                    body: JSON.stringify({ p_event_id: '00000000-0000-4000-8000-000000000000', p_name: 'x', p_phone: '01000000000', p_qty: 1, p_code: 'AAAAAA' }),
                });
                out.book_rpc = rpc.ok;
                if (!rpc.ok) out.rpc_오류 = (await rpc.text().catch(() => '')).slice(0, 200);
            }
        } catch (e) {
            out.진단_오류 = String(e && e.message || e);
        }
        return json(out);
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    try {
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || '');
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(500, 'env', '서버 설정 오류입니다.');

        // ── 공개: 예매 ─────────────────────────────────────────────
        if (action === 'book') {
            const name = String(body.name || '').trim();
            const phone = normPhone(body.phone);
            const qty = parseInt(body.qty, 10);
            if (!isUuid(body.event_id)) return fail(400, 'bad_event', '공연 정보가 올바르지 않습니다.');
            if (!name || name.length > 40) return fail(400, 'bad_name', '이름을 확인해주세요.');
            if (!phone) return fail(400, 'bad_phone', '휴대폰 번호를 확인해주세요.');
            if (!Number.isInteger(qty) || qty < 1 || qty > 10) return fail(400, 'bad_qty', '매수를 확인해주세요.');

            for (let attempt = 0; attempt < 5; attempt++) {
                const r = await sbFetch(env, 'rpc/book_event_ticket', {
                    method: 'POST',
                    body: JSON.stringify({ p_event_id: body.event_id, p_name: name, p_phone: phone, p_qty: qty, p_code: newCode() }),
                });
                if (!r.ok) {
                    return json({ ok: false, error: 'db', message: '예매 처리 중 오류가 발생했습니다.',
                        detail: (await r.text().catch(() => '')).slice(0, 300) }, 502);
                }
                const out = await r.json();
                if (out.ok) return json({ ok: true, ticket: out.ticket, event: out.event });
                if (out.error === 'code_collision') continue; // 새 코드로 재시도
                if (out.error === 'sold_out') {
                    return json({ ok: false, error: 'sold_out', remaining: out.remaining,
                        message: out.remaining > 0 ? `남은 자리가 부족합니다. (잔여 ${out.remaining}석)` : '아쉽지만 매진되었습니다.' }, 409);
                }
                const [st, msg] = BOOK_ERR[out.error] || [502, '예매 처리 중 오류가 발생했습니다.'];
                return fail(st, out.error, msg);
            }
            return fail(502, 'code_collision', '예매번호 생성에 실패했습니다. 다시 시도해주세요.');
        }

        // ── 공개: 예매 조회 ────────────────────────────────────────
        if (action === 'lookup') {
            const code = normCode(body.code);
            const phone = normPhone(body.phone);
            if (!code || !phone) return fail(400, 'bad_input', '예매번호와 휴대폰 번호를 확인해주세요.');
            const t = await findTicketByCodePhone(env, code, phone);
            if (!t) return fail(404, 'not_found', '일치하는 예매가 없습니다. 예매번호와 전화번호를 확인해주세요.');
            const { events: ev, ...ticket } = t;
            return json({ ok: true, ticket, event: ev });
        }

        // ── 공개: 관객 직접 취소 ───────────────────────────────────
        if (action === 'cancel') {
            const code = normCode(body.code);
            const phone = normPhone(body.phone);
            if (!code || !phone) return fail(400, 'bad_input', '예매번호와 휴대폰 번호를 확인해주세요.');
            const t = await findTicketByCodePhone(env, code, phone);
            if (!t) return fail(404, 'not_found', '일치하는 예매가 없습니다.');
            if (t.checked_in_at) return fail(409, 'checked_in', '이미 입장 처리된 티켓은 취소할 수 없습니다.');
            if (t.events && new Date(t.events.starts_at) <= new Date()) {
                return fail(409, 'started', '공연 시작 후에는 취소할 수 없습니다. 호스트에게 문의해주세요.');
            }
            // 조건부 PATCH — 이미 취소된 건은 갱신 0행 → 409
            const r = await sbFetch(env,
                `event_tickets?id=eq.${t.id}&status=in.(pending_payment,confirmed)&checked_in_at=is.null`,
                { method: 'PATCH', headers: { Prefer: 'return=representation' },
                  body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'buyer' }) });
            if (!r.ok) return json({ ok: false, error: 'db', message: '취소 처리 중 오류가 발생했습니다.',
                detail: (await r.text().catch(() => '')).slice(0, 300) }, 502);
            const rows = await r.json().catch(() => []);
            if (!Array.isArray(rows) || rows.length === 0) return fail(409, 'not_cancellable', '취소할 수 없는 상태입니다.');
            return json({ ok: true, ticket: rows[0] });
        }

        // ── 호스트 액션 (카카오 토큰 검증 필수) ────────────────────
        const HOST_ACTIONS = ['host_me', 'create_team', 'update_team', 'list_members', 'remove_member',
            'create_invite', 'accept_invite', 'create_event', 'update_event', 'set_event_status',
            'my_events', 'attendees', 'confirm_payment', 'revert_payment', 'host_cancel', 'checkin', 'uncheckin'];
        if (HOST_ACTIONS.includes(action)) {
            const kk = await verifyKakao(body.kakao_token);
            if (!kk) return fail(401, 'auth', '카카오 로그인이 만료되었습니다. 다시 로그인해주세요.');
            const kakaoId = kk.id;
            const isAdmin = kakaoId === ADMIN_KAKAO_ID;
            const posterOk = (u) => !u || String(u).startsWith(`${env.SUPABASE_URL}/storage/v1/object/public/community-images/events/`);
            // 팀 대상 액션 공통 게이트 — needOwner=true면 owner(또는 ADMIN)만
            const requireTeam = async (hostId, needOwner) => {
                if (!isUuid(hostId)) return { err: [400, 'bad_team', '팀 정보가 올바르지 않습니다.'] };
                if (isAdmin) return { role: 'owner' };
                const m = await getMembership(env, hostId, kakaoId);
                if (!m) return { err: [403, 'not_member', '이 팀의 멤버가 아닙니다.'] };
                if (needOwner && m.role !== 'owner') return { err: [403, 'not_team_owner', '팀 소유자만 할 수 있습니다.'] };
                return { role: m.role };
            };

            if (action === 'host_me') {
                const teams = await getMyTeams(env, kakaoId);
                return json({ ok: true, teams, is_admin: isAdmin });
            }

            if (action === 'create_team' || action === 'update_team') {
                const name = String(body.name || '').trim();
                if (!name || name.length > 40) return fail(400, 'bad_name', '팀 이름을 확인해주세요. (40자 이내)');
                const bio = String(body.bio || '').trim().slice(0, 500) || null;
                const sns = String(body.sns || '').trim().slice(0, 200) || null;
                // 로고는 우리 스토리지 업로드 산출물만 허용
                if (body.logo_url && !String(body.logo_url).startsWith(`${env.SUPABASE_URL}/storage/v1/object/public/community-images/`)) {
                    return fail(400, 'bad_logo', '로고 이미지가 올바르지 않습니다.');
                }
                const logo_url = body.logo_url ? String(body.logo_url) : null;
                if (action === 'create_team') {
                    const r = await sbFetch(env, 'event_hosts', {
                        method: 'POST', headers: { Prefer: 'return=representation' },
                        body: JSON.stringify({ kakao_id: kakaoId, name, bio, sns, logo_url }),
                    });
                    if (!r.ok) return json({ ok: false, error: 'db', message: '팀 생성에 실패했습니다.',
                        detail: (await r.text().catch(() => '')).slice(0, 300) }, 502);
                    const [team] = await r.json();
                    const mr = await sbFetch(env, 'event_host_members', {
                        method: 'POST', body: JSON.stringify({ host_id: team.id, kakao_id: kakaoId, name: kk.nickname || null, role: 'owner' }),
                    });
                    if (!mr.ok) return fail(502, 'db', '팀 멤버십 생성에 실패했습니다.');
                    return json({ ok: true, team: { ...team, my_role: 'owner' } });
                }
                const gate = await requireTeam(body.host_id, true);
                if (gate.err) return fail(...gate.err);
                const r = await sbFetch(env, `events?host_id=eq.${body.host_id}`, {
                    method: 'PATCH', body: JSON.stringify({ host_name: name }),
                });
                if (!r.ok) { /* host_name 동기화 실패는 치명적이지 않음 */ }
                const tr = await sbFetch(env, `event_hosts?id=eq.${body.host_id}`, {
                    method: 'PATCH', headers: { Prefer: 'return=representation' },
                    body: JSON.stringify({ name, bio, sns, logo_url }),
                });
                if (!tr.ok) return fail(502, 'db', '팀 수정에 실패했습니다.');
                const [team] = await tr.json();
                return json({ ok: true, team: { ...team, my_role: gate.role } });
            }

            if (action === 'list_members') {
                const gate = await requireTeam(body.host_id, false);
                if (gate.err) return fail(...gate.err);
                const r = await sbFetch(env, `event_host_members?host_id=eq.${body.host_id}&select=kakao_id,name,role,created_at&order=created_at.asc`);
                if (!r.ok) return fail(502, 'db', '멤버 조회에 실패했습니다.');
                return json({ ok: true, members: await r.json(), my_role: gate.role, my_kakao_id: kakaoId });
            }

            if (action === 'remove_member') {
                const gate = await requireTeam(body.host_id, true);
                if (gate.err) return fail(...gate.err);
                const target = String(body.member_kakao_id || '');
                if (!target) return fail(400, 'bad_member', '대상이 올바르지 않습니다.');
                // owner는 내보낼 수 없음(창설자 보호) — 조건부 DELETE
                const r = await sbFetch(env, `event_host_members?host_id=eq.${body.host_id}&kakao_id=eq.${encodeURIComponent(target)}&role=eq.member`, {
                    method: 'DELETE', headers: { Prefer: 'return=representation' },
                });
                if (!r.ok) return fail(502, 'db', '멤버 삭제에 실패했습니다.');
                const rows = await r.json().catch(() => []);
                if (!rows.length) return fail(409, 'not_removable', '팀 소유자는 내보낼 수 없습니다.');
                return json({ ok: true });
            }

            if (action === 'create_invite') {
                const gate = await requireTeam(body.host_id, true);
                if (gate.err) return fail(...gate.err);
                // 기존 토큰은 대체(취소) — 팀당 유효 토큰 1개
                await sbFetch(env, `event_host_invites?host_id=eq.${body.host_id}`, { method: 'DELETE' }).catch(() => {});
                const token = newToken();
                const expires = new Date(Date.now() + 7 * 86400e3).toISOString();
                const r = await sbFetch(env, 'event_host_invites', {
                    method: 'POST', headers: { Prefer: 'return=representation' },
                    body: JSON.stringify({ token, host_id: body.host_id, created_by: kakaoId, expires_at: expires }),
                });
                if (!r.ok) return fail(502, 'db', '초대 생성에 실패했습니다.');
                return json({ ok: true, token, expires_at: expires });
            }

            if (action === 'accept_invite') {
                const token = String(body.token || '');
                if (!/^[0-9a-f]{32}$/.test(token)) return fail(400, 'bad_token', '초대 링크가 올바르지 않습니다.');
                const sel = '*,event_hosts(id,name)';
                const r = await sbFetch(env, `event_host_invites?token=eq.${token}&select=${encodeURIComponent(sel)}&limit=1`);
                if (!r.ok) return fail(502, 'db', '초대 확인에 실패했습니다.');
                const [inv] = await r.json();
                if (!inv || !inv.event_hosts) return fail(404, 'not_found', '유효하지 않은 초대입니다. 호스트에게 새 초대 링크를 요청해주세요.');
                if (new Date(inv.expires_at) <= new Date()) return fail(409, 'expired', '만료된 초대입니다. 호스트에게 새 초대 링크를 요청해주세요.');
                const mr = await sbFetch(env, 'event_host_members?on_conflict=host_id,kakao_id', {
                    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
                    body: JSON.stringify({ host_id: inv.host_id, kakao_id: kakaoId, name: kk.nickname || null, role: 'member' }),
                });
                if (!mr.ok) return fail(502, 'db', '팀 합류에 실패했습니다.');
                return json({ ok: true, team: { id: inv.event_hosts.id, name: inv.event_hosts.name } });
            }

            if (action === 'create_event') {
                const gate = await requireTeam(body.host_id, false);
                if (gate.err) return fail(...gate.err);
                const hr = await sbFetch(env, `event_hosts?id=eq.${body.host_id}&select=*&limit=1`);
                if (!hr.ok) return fail(502, 'db', '팀 조회에 실패했습니다.');
                const [host] = await hr.json();
                if (!host) return fail(404, 'no_host', '팀을 찾을 수 없습니다. 먼저 팀을 등록해주세요.');
                const e = body.event || {};
                const v = validateEventFields(e, { partial: false });
                if (v.error) return fail(400, 'bad_event', v.error);
                if (!posterOk(e.poster_url)) return fail(400, 'bad_poster', '포스터 이미지가 올바르지 않습니다.');
                const fields = v.fields;
                if (e.description !== undefined) fields.description = String(e.description || '').slice(0, 12000);
                if (fields.price > 0) {
                    fields.bank_info = String(e.bank_info || '').trim().slice(0, 120) || host.bank_info || null;
                    if (!fields.bank_info) return fail(400, 'need_bank', '유료 공연은 입금 계좌가 필요합니다.');
                } else {
                    fields.bank_info = null;
                }
                const r = await sbFetch(env, 'events', {
                    method: 'POST', headers: { Prefer: 'return=representation' },
                    body: JSON.stringify({ ...fields, poster_url: e.poster_url || null, host_id: host.id, host_name: host.name }),
                });
                if (!r.ok) return json({ ok: false, error: 'db', message: '공연 등록에 실패했습니다.',
                    detail: (await r.text().catch(() => '')).slice(0, 300) }, 502);
                const [ev] = await r.json();
                return json({ ok: true, event: ev });
            }

            if (action === 'update_event') {
                const { ev, err } = await getEventOwned(env, body.event_id, kakaoId);
                if (err) return fail(...err);
                const e = body.patch || {};
                const v = validateEventFields(e, { partial: true });
                if (v.error) return fail(400, 'bad_event', v.error);
                const fields = v.fields;
                if (e.poster_url !== undefined) {
                    if (!posterOk(e.poster_url)) return fail(400, 'bad_poster', '포스터 이미지가 올바르지 않습니다.');
                    fields.poster_url = e.poster_url || null;
                }
                if (fields.capacity !== undefined) {
                    const tr = await sbFetch(env, `event_tickets?event_id=eq.${ev.id}&status=in.(pending_payment,confirmed)&select=qty`);
                    const taken = tr.ok ? (await tr.json()).reduce((n, t) => n + (t.qty || 0), 0) : 0;
                    if (fields.capacity < taken) return fail(409, 'capacity_low', `이미 ${taken}석이 예매되어 정원을 그 아래로 줄일 수 없습니다.`);
                }
                const newPrice = fields.price !== undefined ? fields.price : ev.price;
                const newBank = fields.bank_info !== undefined ? fields.bank_info : ev.bank_info;
                if (newPrice > 0 && !newBank) return fail(400, 'need_bank', '유료 공연은 입금 계좌가 필요합니다.');
                if (!Object.keys(fields).length) return fail(400, 'empty_patch', '수정할 내용이 없습니다.');
                fields.updated_at = new Date().toISOString();
                const r = await sbFetch(env, `events?id=eq.${ev.id}`, {
                    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields),
                });
                if (!r.ok) return json({ ok: false, error: 'db', message: '공연 수정에 실패했습니다.',
                    detail: (await r.text().catch(() => '')).slice(0, 300) }, 502);
                const [row] = await r.json();
                return json({ ok: true, event: row });
            }

            if (action === 'set_event_status') {
                const { ev, err } = await getEventOwned(env, body.event_id, kakaoId);
                if (err) return fail(...err);
                const st = String(body.status || '');
                if (!['published', 'closed', 'hidden'].includes(st)) return fail(400, 'bad_status', '상태 값이 올바르지 않습니다.');
                const r = await sbFetch(env, `events?id=eq.${ev.id}`, {
                    method: 'PATCH', headers: { Prefer: 'return=representation' },
                    body: JSON.stringify({ status: st, updated_at: new Date().toISOString() }),
                });
                if (!r.ok) return fail(502, 'db', '상태 변경에 실패했습니다.');
                const [row] = await r.json();
                return json({ ok: true, event: row });
            }

            if (action === 'my_events') {
                let q;
                if (isAdmin && !body.host_id) {
                    q = 'events?select=*&order=starts_at.desc'; // 관리자 전체 보기
                } else {
                    const gate = await requireTeam(body.host_id, false);
                    if (gate.err) return fail(...gate.err);
                    q = `events?host_id=eq.${body.host_id}&select=*&order=starts_at.desc`;
                }
                const r = await sbFetch(env, q);
                if (!r.ok) return fail(502, 'db', '공연 목록 조회에 실패했습니다.');
                const events = await r.json();
                const stats = {};
                if (events.length) {
                    const ids = events.map(e => e.id).join(',');
                    const tr = await sbFetch(env, `event_tickets?event_id=in.(${ids})&select=event_id,qty,status,checked_in_at`);
                    if (tr.ok) {
                        for (const t of await tr.json()) {
                            const s = stats[t.event_id] || (stats[t.event_id] = { taken: 0, pending: 0, confirmed: 0, checked_in: 0 });
                            if (t.status === 'pending_payment') { s.pending += t.qty; s.taken += t.qty; }
                            else if (t.status === 'confirmed') { s.confirmed += t.qty; s.taken += t.qty; }
                            if (t.checked_in_at) s.checked_in += t.qty;
                        }
                    }
                }
                return json({ ok: true, is_admin: isAdmin,
                    events: events.map(e => ({ ...e, stats: stats[e.id] || { taken: 0, pending: 0, confirmed: 0, checked_in: 0 } })) });
            }

            if (action === 'attendees') {
                const { ev, err } = await getEventOwned(env, body.event_id, kakaoId);
                if (err) return fail(...err);
                const r = await sbFetch(env, `event_tickets?event_id=eq.${ev.id}&select=*&order=created_at.desc`);
                if (!r.ok) return fail(502, 'db', '예매자 명단 조회에 실패했습니다.');
                return json({ ok: true, event: ev, tickets: await r.json() });
            }

            if (action === 'confirm_payment' || action === 'revert_payment' || action === 'host_cancel' || action === 'uncheckin') {
                const { t, err } = await getTicketOwned(env, body.ticket_id, kakaoId);
                if (err) return fail(...err);
                const now = new Date().toISOString();
                const spec = {
                    confirm_payment: { cond: 'status=eq.pending_payment', set: { status: 'confirmed', confirmed_at: now },
                        msg: '입금 확인할 수 없는 상태입니다.' },
                    revert_payment: { cond: 'status=eq.confirmed&checked_in_at=is.null', set: { status: 'pending_payment', confirmed_at: null },
                        msg: '확정 취소할 수 없는 상태입니다. (입장 완료 여부 확인)' },
                    host_cancel: { cond: 'status=in.(pending_payment,confirmed)&checked_in_at=is.null',
                        set: { status: 'cancelled', cancelled_at: now, cancelled_by: 'host' }, msg: '취소할 수 없는 상태입니다.' },
                    uncheckin: { cond: 'checked_in_at=not.is.null', set: { checked_in_at: null }, msg: '입장 처리된 티켓이 아닙니다.' },
                }[action];
                const r = await sbFetch(env, `event_tickets?id=eq.${t.id}&${spec.cond}`, {
                    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(spec.set),
                });
                if (!r.ok) return fail(502, 'db', '처리 중 오류가 발생했습니다.');
                const rows = await r.json().catch(() => []);
                if (!rows.length) return fail(409, 'conflict', spec.msg);
                return json({ ok: true, ticket: rows[0] });
            }

            if (action === 'checkin') {
                const code = normCode(body.code);
                if (!code) return fail(400, 'bad_code', '예매번호를 확인해주세요.');
                const sel = '*,events(id,title,starts_at,host_id)';
                const r = await sbFetch(env, `event_tickets?code=eq.${code}&select=${encodeURIComponent(sel)}&limit=1`);
                if (!r.ok) return fail(502, 'db', '티켓 조회에 실패했습니다.');
                const [t] = await r.json();
                if (!t) return fail(404, 'not_found', '없는 예매번호입니다.');
                if (!isAdmin) {
                    const m = t.events ? await getMembership(env, t.events.host_id, kakaoId) : null;
                    if (!m) return fail(403, 'not_owner', '이 공연의 티켓이 아닙니다. (다른 팀의 공연)');
                }
                const info = { id: t.id, code: t.code, buyer_name: t.buyer_name, qty: t.qty, event_id: t.events.id, event_title: t.events.title };
                if (t.status === 'cancelled') return json({ ok: false, error: 'cancelled', message: '취소된 티켓입니다.', ticket: info }, 409);
                if (t.checked_in_at) return json({ ok: false, error: 'already_checked_in',
                    message: '이미 입장 처리된 티켓입니다.', checked_in_at: t.checked_in_at, ticket: info }, 409);
                if (t.status === 'pending_payment') return json({ ok: false, error: 'not_confirmed',
                    message: '입금 확인이 안 된 티켓입니다.', ticket: info }, 409);
                const pr = await sbFetch(env, `event_tickets?id=eq.${t.id}&status=eq.confirmed&checked_in_at=is.null`, {
                    method: 'PATCH', headers: { Prefer: 'return=representation' },
                    body: JSON.stringify({ checked_in_at: new Date().toISOString() }),
                });
                if (!pr.ok) return fail(502, 'db', '체크인 처리에 실패했습니다.');
                const rows = await pr.json().catch(() => []);
                if (!rows.length) return fail(409, 'conflict', '방금 다른 기기에서 처리되었습니다. 명단을 확인해주세요.');
                return json({ ok: true, ticket: { ...rows[0], event_title: t.events.title } });
            }
        }

        return fail(400, 'unknown_action', '알 수 없는 요청입니다.');
    } catch (e) {
        return json({ ok: false, error: 'internal', message: '서버 오류가 발생했습니다.', detail: String(e && e.message || e) }, 500);
    }
}
