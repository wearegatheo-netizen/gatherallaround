// Cloudflare Pages Function: /gatheo-api
// 게더링(멤버·관리자)·합주팀·공간 대관 화면의 **쓰기 전부 + 개인정보가 든 읽기**를 대신 수행한다 (service role).
//
// 배경(2026-11-10): 카카오 로그인 멤버는 Supabase 입장에서 전부 anon 이라, 관리자 권한(승인·차단·공지)과
// 본인 확인을 DB 가 가릴 수 없었다. 브라우저의 supabaseClient.from(...) 호출을 그대로 받아(index.html 의 gw 래퍼가
// 메서드 호출 목록을 보낸다) **누가 보냈는지 확인하고 표·동작별 규칙을 검사한 뒤** PostgREST 로 실행한다.
// 이 함수가 배포된 뒤 supabase/migrations/20261110_gatheo_lockdown.sql 을 실행하면 anon 키로는 직접 쓸 수 없게 된다.
//
// 신원 (본문에 하나)
//   session     : login 액션이 발급한 30일 토큰 (HMAC, 서버 저장 없음 — 요청마다 프로필을 다시 읽어 승인·역할을 판정)
//   kakao_token : 카카오 access token → kapi.kakao.com 검증
//   sb_token    : Supabase 세션 토큰 → /auth/v1/user (합주팀 계정·이메일 가입 멤버)
//   없음        : 익명 — 공간 대관 신청·조회 같은 공개 동작만
//
// 액션
//   ping                                   → { ok }
//   login {kakao_token}                    → { session, exp, kakao_id, profile }
//   db {table, calls:[[메서드, ...인자]]}  → { data, error, count }   (supabase-js 응답 모양)
//   kakao_link {name, phone}               → 카카오 미연동 계정을 이름+연락처로 찾아 내 카카오 ID 연결
//   find_id {name, phone}                  → { masked } (가려진 이메일)
//   perf_lookup {code, phone}              → { booking } (연락처까지 맞아야)
//   perf_cancel {id, phone}                → { ok } 고객 취소
//
// 에러 규약: HTTP 는 400/401/403/500, db 액션의 규칙 위반·DB 오류는 200 + { data:null, error:{message, code} }
//   (화면의 기존 오류 처리 — error.message / error.code — 가 그대로 동작하도록)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import '../shared/rules.js';

const ADMIN_KAKAO_ID = '4883868250'; // index.html ADMIN_ID 와 동일
export const TIMES = globalThis.GAA_RULES.TIMES;
const SESSION_DAYS = 30;
const PERF_EXPIRE_MS = globalThis.GAA_RULES.PERF_EXPIRE_MS;
const PERF_SAFE_COLS = ['id', 'date', 'start_time', 'end_time', 'status', 'created_at']; // 달력용 — anon 도 직접 읽는다
const BAND_PUBLIC_COLS = ['id', 'band_name_kr', 'band_name_en', 'leader_name', 'leader_phone', 'timeslots', 'band_ended_at', 'band_end_date'];
const SELF_COLS = ['phone', 'instruments', 'music_taste', 'avatar_url', 'push_subscription'];
const BAND_SELF_COLS = ['band_name_kr', 'band_name_en', 'leader_name', 'leader_phone', 'name', 'phone', 'push_subscription', 'avatar_url'];
const MGR_PROFILE_COLS = ['name', 'phone', 'email', 'instruments', 'status', 'avatar_url', 'music_taste', 'hidden'];
const SIGNUP_COLS = ['id', 'kakao_id', 'name', 'email', 'phone', 'instruments', 'music_taste', 'avatar_url', 'status', 'role'];
const BAND_SIGNUP_COLS = ['id', 'name', 'phone', 'leader_name', 'leader_phone', 'band_name_kr', 'band_name_en', 'timeslots', 'member_type', 'instruments',
    'status', 'role', 'band_cabinet', 'band_start_date', 'band_expected_months', 'band_fee', 'band_deposit'];
const PERF_INSERT_COLS = ['name', 'phone', 'purpose', 'how_found', 'date', 'start_time', 'end_time', 'headcount', 'booking_code'];

// 백업 내려받기 대상(운영 총괄 전용) — 로그인 세션·시도 기록·오류 기록처럼 복구에 쓸모없는 표는 뺀다. 사진 파일(Storage)은 포함되지 않는다.
export const BACKUP_TABLES = ['profiles', 'reservations', 'time_blocks', 'performance_bookings', 'comments', 'notices', 'documents', 'teams',
    'schedules', 'schedule_attendees', 'schedule_guests', 'polls', 'poll_votes', 'app_settings',
    'community_meetings', 'community_applications', 'community_visits',
    'band_members', 'band_comments', 'band_notices', 'band_payments', 'band_rent_reminders', 'band_slot_defs', 'band_slot_claims', 'band_skips', 'band_pins', 'band_sms_log',
    'events', 'event_hosts', 'event_host_profiles', 'event_host_members', 'event_host_invites', 'event_co_teams', 'event_co_invites', 'event_tickets', 'event_ticket_seats', 'event_ticket_transfers',
    'wappen_users', 'wappen_projects', 'wappen_works', 'wappen_items', 'wappen_reactions', 'wappen_item_requests', 'wappen_reports'];
const BACKUP_PAGE = 1000;

function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }
const isOurHost = (h) => h === 'gatherallaround.com' || h === 'localhost' || h === '127.0.0.1' || /\.(gatherallaround\.com|pages\.dev)$/.test(h);
function corsFor(origin) {
    const host = hostOf(origin);
    const allowed = origin && (origin === 'https://gatherallaround.com' || origin === 'https://www.gatherallaround.com' || /\.(pages\.dev|gatherallaround\.com)$/.test(host));
    return {
        'Access-Control-Allow-Origin': allowed ? origin : 'https://gatherallaround.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}
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
const digits = v => String(v || '').replace(/\D/g, '');
const enc = encodeURIComponent;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const subset = (keys, allowed) => keys.every(k => allowed.includes(k));
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// ───────── 세션 토큰 (HMAC-SHA256, 키는 service role 키에서 파생 — 새 환경변수 없음) ─────────
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = (s) => b64u(new TextEncoder().encode(s));
function b64uDecode(s) {
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
async function hmacKey(env) {
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gatheo-session:v1:' + env.SUPABASE_SERVICE_ROLE_KEY));
    return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
export async function signSession(env, kid, now = Date.now()) {
    const exp = now + SESSION_DAYS * 86400 * 1000;
    const payload = b64uText(JSON.stringify({ k: String(kid), e: exp }));
    const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(payload)));
    return { session: payload + '.' + sig, exp };
}
export async function verifySession(env, token, now = Date.now()) {
    if (!token || typeof token !== 'string' || token.length > 600) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const want = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(payload)));
    if (want.length !== sig.length) return null;
    let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff) return null;
    try {
        const p = JSON.parse(b64uDecode(payload));
        if (!p || !p.k || !(p.e > now)) return null;
        return String(p.k);
    } catch (_) { return null; }
}

async function verifyKakao(token) {
    if (!token || typeof token !== 'string' || token.length > 512) return null;
    try {
        const r = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        return u && u.id ? String(u.id) : null;
    } catch (_) { return null; }
}
async function verifySb(env, jwt) {
    if (!jwt || typeof jwt !== 'string' || jwt.length > 4096) return null;
    try {
        const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + jwt } });
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        return u && u.id && isUuid(u.id) ? { id: String(u.id), email: String(u.email || '') } : null;
    } catch (_) { return null; }
}

// ───────── 요청자 ─────────
const isAdminLogin = (p) => !!p && (String(p.instruments || '').trim().toLowerCase() === 'wearegatheo' || String(p.email || '').toLowerCase().startsWith('wearegatheo@'));
export function makeActor({ kid = null, sb = null, profile = null } = {}) {
    const p = profile || null;
    const approved = !!p && p.status === 'approved';
    const band = !!p && p.member_type === 'band';
    const member = approved && !band;
    const role = p ? String(p.role || '') : '';
    const sup = kid === ADMIN_KAKAO_ID || (member && role === '운영 총괄');
    const lead = sup || (member && role === '총괄');
    const mgr = lead || (member && role === '세션장');
    // 카카오와 연결된 이메일 계정(게더링 멤버)은 이메일로 로그인해도 「카카오 ID」가 그 사람의 기록 키(예약·게시글 kakao_id) —
    // 어느 방법으로 로그인하든 같은 사람으로 보이게(2026-11-23). 합주팀 계정은 해당 없음.
    const linkedKid = !kid && sb && p && !band && p.kakao_id ? String(p.kakao_id) : null;
    return {
        kid, sbUid: sb ? sb.id : null, sbEmail: sb ? sb.email : '', uid: kid || linkedKid || (sb ? sb.id : null), p,
        approved, band, member, role, sup, lead, mgr,
        bandOk: approved && band, bandAdmin: approved && band && isAdminLogin(p),
        ownFilter: kid ? `kakao_id=eq.${enc(kid)}` : (sb ? `id=eq.${sb.id}` : null),
    };
}
// 이 프로필 id 로 이메일 로그인 계정(Supabase Auth)이 있는가 — 확인하지 못하면 「있다」로 본다(안전한 쪽)
async function hasAuthUser(env, id) {
    if (!isUuid(id)) return false;
    try {
        const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } });
        if (r.status === 404) return false;
        return true;
    } catch (_) { return true; }
}
// 이메일 로그인 때 계정 id(uuid)로 남긴 내 기록을 카카오 ID 로 옮긴다 → 어느 방법으로 로그인해도 「내 예약·내 글」이 같다. 옮긴 행 수.
const IDENTITY_TABLES = [['reservations', 'kakao_id'], ['comments', 'kakao_id'], ['polls', 'created_by']];
async function syncIdentity(env, profileId, kid) {
    if (!isUuid(profileId) || !kid || String(kid) === String(profileId)) return 0;
    let moved = 0;
    for (const [table, col] of IDENTITY_TABLES) {
        try {
            const r = await sbFetch(env, `${table}?${col}=eq.${profileId}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ [col]: String(kid) }) });
            if (r.ok) moved += ((await r.json().catch(() => [])) || []).length;
        } catch (_) {}
    }
    return moved;
}
async function profileBy(env, filter) {
    const r = await sbFetch(env, `profiles?select=*&${filter}&limit=1`);
    return r.ok ? (((await r.json().catch(() => [])) || [])[0] || null) : null;
}
// 한 브라우저에 카카오 멤버와 합주팀 계정이 같이 로그인돼 있을 수 있어 둘 다 받는다 — 규칙을 통과하는 첫 신원으로 실행.
// prefer:'sb' 면 합주팀 화면에서 온 요청(계정 신원 먼저). 보낸 신원이 전부 무효면 bad.
async function resolveActors(env, body) {
    const out = [];
    let sent = 0;
    const kakaoCred = body.session || body.kakao_token;
    if (kakaoCred) {
        sent++;
        const kid = body.session ? await verifySession(env, body.session) : await verifyKakao(body.kakao_token);
        if (kid) out.push(makeActor({ kid, profile: await profileBy(env, `kakao_id=eq.${enc(kid)}`) }));
    }
    if (body.sb_token) {
        sent++;
        const sb = await verifySb(env, body.sb_token);
        if (sb) out.push(makeActor({ sb, profile: await profileBy(env, `id=eq.${sb.id}`) }));
    }
    if (sent && !out.length) return { bad: true, actors: [] };
    if (body.prefer === 'sb') out.sort((x, y) => (y.sbUid ? 1 : 0) - (x.sbUid ? 1 : 0));
    if (!out.length) out.push(makeActor());
    return { bad: false, actors: out };
}

// ───────── supabase-js 호출 목록 → 실행 명세 ─────────
const FILTERS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'not'];
export function parseCalls(calls) {
    if (!Array.isArray(calls) || !calls.length || calls.length > 40) throw new Error('bad_calls');
    const [op, a1, a2] = calls[0];
    const spec = { op, values: null, opts: {}, filters: [], order: [], limit: null, range: null, select: null, single: null };
    if (op === 'select') { spec.select = a1 == null ? '*' : String(a1); spec.opts = a2 || {}; }
    else if (op === 'insert' || op === 'upsert' || op === 'update') { spec.values = a1; spec.opts = a2 || {}; }
    else if (op === 'delete') { /* no args */ }
    else throw new Error('bad_op');
    for (const c of calls.slice(1)) {
        const [m, ...a] = c;
        if (FILTERS.includes(m)) {
            if (!IDENT.test(String(a[0]))) throw new Error('bad_column');
            spec.filters.push([m, ...a]);
        } else if (m === 'order') {
            if (!IDENT.test(String(a[0]))) throw new Error('bad_column');
            spec.order.push([a[0], a[1] || {}]);
        } else if (m === 'limit') spec.limit = Math.max(0, Math.min(5000, parseInt(a[0], 10) || 0));
        else if (m === 'range') spec.range = [parseInt(a[0], 10) || 0, parseInt(a[1], 10) || 0];
        else if (m === 'select') spec.select = a[0] == null ? '*' : String(a[0]);
        else if (m === 'single' || m === 'maybeSingle') spec.single = m;
        else throw new Error('bad_method:' + m);
    }
    if (spec.select != null && !/^[A-Za-z0-9_,* ]{1,400}$/.test(spec.select)) throw new Error('bad_select');
    if (spec.values != null) {
        const rows = Array.isArray(spec.values) ? spec.values : [spec.values];
        if (!rows.length || rows.length > 500) throw new Error('bad_values');
        for (const r of rows) {
            if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('bad_values');
            for (const k of Object.keys(r)) if (!IDENT.test(k)) throw new Error('bad_column');
        }
    }
    if ((op === 'update' || op === 'delete') && !spec.filters.some(f => f[0] === 'eq' || f[0] === 'in' || f[0] === 'lt')) throw new Error('no_filter');
    return spec;
}
const fval = (v) => (v === null ? 'null' : String(v));
const inList = (arr) => '(' + (arr || []).map(v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
function filterQS(f) {
    const [m, col, a, b] = f;
    if (m === 'in') return `${col}=in.${enc(inList(a))}`;
    if (m === 'not') return `${col}=not.${a}.${enc(Array.isArray(b) ? inList(b) : fval(b))}`;
    return `${col}=${m}.${enc(fval(a))}`;
}
export function buildQuery(table, spec, extra = []) {
    const qs = spec.filters.map(filterQS).concat(extra);
    const returning = spec.op === 'select' || spec.select != null;
    if (returning) qs.push('select=' + enc((spec.select || '*').replace(/\s+/g, '')));
    for (const [col, o] of spec.order) qs.push(`order=${col}.${o && o.ascending === false ? 'desc' : 'asc'}${o && o.nullsFirst ? '.nullsfirst' : ''}`);
    if (spec.limit != null) qs.push('limit=' + spec.limit);
    if (spec.range) { qs.push('offset=' + spec.range[0]); qs.push('limit=' + Math.max(0, spec.range[1] - spec.range[0] + 1)); }
    const prefer = [];
    let method = 'GET';
    if (spec.op === 'insert') { method = 'POST'; prefer.push(returning ? 'return=representation' : 'return=minimal'); }
    else if (spec.op === 'upsert') {
        method = 'POST'; prefer.push('resolution=' + (spec.opts && spec.opts.ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates'), returning ? 'return=representation' : 'return=minimal');
        if (spec.opts && spec.opts.onConflict && /^[a-z0-9_,]+$/.test(spec.opts.onConflict)) qs.push('on_conflict=' + spec.opts.onConflict);
    } else if (spec.op === 'update') { method = 'PATCH'; prefer.push(returning ? 'return=representation' : 'return=minimal'); }
    else if (spec.op === 'delete') { method = 'DELETE'; prefer.push(returning ? 'return=representation' : 'return=minimal'); }
    return { path: `${table}?${qs.join('&')}`, method, prefer: prefer.join(','), returning };
}
async function execSpec(env, table, spec, extra = []) {
    const q = buildQuery(table, spec, extra);
    const r = await sbFetch(env, q.path, {
        method: q.method,
        headers: q.prefer ? { Prefer: q.prefer } : {},
        body: spec.values != null ? JSON.stringify(spec.values) : undefined,
    });
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch (_) {}
    if (!r.ok) return { data: null, error: { message: (j && j.message) || `HTTP ${r.status}`, code: (j && j.code) || String(r.status), details: (j && j.details) || null, hint: (j && j.hint) || null } };
    let data = q.returning ? (j || []) : null;
    if (q.returning && spec.single) {
        const rows = Array.isArray(data) ? data : [data];
        if (rows.length === 1) data = rows[0];
        else if (rows.length === 0 && spec.single === 'maybeSingle') data = null;
        else return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: `Results contain ${rows.length} rows` } };
    }
    return { data, error: null };
}
const deny = (message, code = 'FORBIDDEN') => ({ data: null, error: { message, code } });
const NEED_LOGIN = '로그인이 필요합니다. 다시 로그인한 뒤 시도해주세요.';
const NEED_ROLE = '이 작업을 할 권한이 없습니다.';

const rowsOf = (v) => (Array.isArray(v) ? v : [v]);
const eqFilter = (spec, col) => { const f = spec.filters.find(x => x[0] === 'eq' && x[1] === col); return f ? f[2] : undefined; };

// 겹침 확인 — 같은 날짜의 게더링 예약 + 살아 있는 대관(확정 + 4시간 안 지난 대기). 슬롯은 시작 시각 기준(끝 = 마지막 슬롯 시작)
async function slotTaken(env, date, start, end) {
    const s = TIMES.indexOf(String(start).slice(0, 5)), e = TIMES.indexOf(String(end).slice(0, 5));
    if (s < 0 || e < 0 || e < s) return 'bad';
    const [r1, r2] = await Promise.all([
        sbFetch(env, `reservations?select=start_time,end_time,status&res_date=eq.${enc(date)}`),
        sbFetch(env, `performance_bookings?select=start_time,end_time,status,created_at&date=eq.${enc(date)}`),
    ]);
    const res = r1.ok ? await r1.json().catch(() => []) : [];
    const pb = r2.ok ? await r2.json().catch(() => []) : [];
    const live = [
        ...res.filter(x => x.status !== 'rejected' && x.status !== 'cancelled'),
        ...pb.filter(x => x.status === 'approved' || (x.status === 'pending' && Date.now() - new Date(x.created_at).getTime() < PERF_EXPIRE_MS)),
    ];
    return live.some(c => {
        const cs = TIMES.indexOf(String(c.start_time).slice(0, 5)), ce = TIMES.indexOf(String(c.end_time).slice(0, 5));
        return cs >= 0 && ce >= 0 && s <= ce && e >= cs;
    });
}
const SLOT_TAKEN_MSG = 'SLOT_TAKEN: 방금 다른 예약이 먼저 들어왔습니다. 다른 시간을 선택해주세요.';

function guardAdminMarks(a, rows) {
    for (const v of rows) {
        if ('instruments' in v && String(v.instruments || '').trim().toLowerCase() === 'wearegatheo' && !a.bandAdmin) return true;
        if ('email' in v && String(v.email || '').toLowerCase().startsWith('wearegatheo@') && !a.bandAdmin) return true;
    }
    return false;
}

// ───────── 표별 규칙 ─────────
// 반환: { error } 로 거절하거나 { extra:[추가 필터], post:(rows)=>rows } 로 통과. spec 은 필요하면 고쳐 쓴다(값 강제).
export const POLICY = {
    async profiles(env, a, spec) {
        const cols = spec.select ? spec.select.replace(/\s+/g, '').split(',') : [];
        if (spec.op === 'select') {
            if (!a.uid) return deny(NEED_LOGIN, 'UNAUTHORIZED');
            if (a.mgr || a.bandAdmin) return {};
            if (a.member) {
                const strip = (rows) => rows.map(r => (r && a.p && r.id !== a.p.id && 'push_subscription' in r && cols.join() !== 'push_subscription') ? { ...r, push_subscription: null } : r);
                return { extra: ['or=(member_type.is.null,member_type.neq.band)'], post: strip };
            }
            if (a.bandOk) {
                if (cols.length && !cols.includes('*') && subset(cols, BAND_PUBLIC_COLS)) return { extra: ['member_type=eq.band', 'status=eq.approved'] };
                if (cols.join() === 'push_subscription') return {};
                return { extra: [a.ownFilter] };
            }
            return { extra: [a.ownFilter] }; // 미가입·승인 대기: 본인 행만
        }
        const rows = spec.values != null ? rowsOf(spec.values) : [];
        if (guardAdminMarks(a, rows)) return deny(NEED_ROLE);
        if (spec.op === 'insert' || spec.op === 'upsert') {
            if (rows.length !== 1) return deny(NEED_ROLE);
            const v = rows[0];
            if (v.member_type === 'band') { // 합주팀 가입 신청 — 방금 만든 auth 계정 본인
                if (a.kid) return deny(NEED_ROLE);
                if (a.p && !(a.p.member_type === 'band' && a.p.status === 'pending')) return deny('이미 가입된 계정입니다.');
                const out = {}; for (const k of BAND_SIGNUP_COLS) if (k in v) out[k] = v[k];
                out.member_type = 'band'; out.status = 'pending'; out.role = '일반';
                if (a.sbUid) { out.id = a.sbUid; out.instruments = String(a.sbEmail || '').split('@')[0] || out.instruments; }
                else { // 가입 직후 세션이 없는 설정(이메일 확인 등) — 새 행 추가만(기존 행 덮어쓰기 불가)
                    if (!isUuid(out.id)) return deny('잘못된 요청입니다.', 'BAD_REQUEST');
                    spec.op = 'insert'; spec.opts = {};
                }
                spec.values = Array.isArray(spec.values) ? [out] : out;
                return {};
            }
            if (spec.op === 'upsert') return deny(NEED_ROLE);
            if (a.p) return deny('이미 가입 신청된 계정입니다.');
            const out = {}; for (const k of SIGNUP_COLS) if (k in v) out[k] = v[k];
            out.status = 'pending'; out.role = '일반';
            if (a.kid) out.kakao_id = a.kid; else delete out.kakao_id;
            if (a.sbUid) out.id = a.sbUid;
            if (!isUuid(out.id)) return deny('잘못된 요청입니다.', 'BAD_REQUEST');
            spec.values = Array.isArray(spec.values) ? [out] : out;
            return {};
        }
        if (spec.op === 'update') {
            if (!a.uid) return deny(NEED_LOGIN, 'UNAUTHORIZED');
            const keys = Object.keys(rows[0] || {});
            if ('kakao_id' in rows[0] || 'member_type' in rows[0] || 'id' in rows[0]) return deny(NEED_ROLE);
            if (a.bandAdmin) return 'role' in rows[0] ? deny(NEED_ROLE) : { extra: ['member_type=eq.band'] };
            const selfCols = a.p && a.p.member_type === 'band' ? BAND_SELF_COLS : SELF_COLS;
            const targetsSelf = a.p && (eqFilter(spec, 'id') === a.p.id || (a.kid && eqFilter(spec, 'kakao_id') === a.kid));
            if (targetsSelf && subset(keys, selfCols)) {
                if (a.p.member_type === 'band' && rows[0].band_name_kr === '게더링' && a.p.band_name_kr !== '게더링') return deny('사용할 수 없는 밴드명입니다.');
                return { extra: [a.ownFilter] };
            }
            const gatheoOnly = 'or=(member_type.is.null,member_type.neq.band)';
            if (keys.includes('role')) return a.sup && subset(keys, ['role']) ? { extra: [gatheoOnly] } : deny(NEED_ROLE);
            if (a.mgr && subset(keys, MGR_PROFILE_COLS)) return { extra: [gatheoOnly] };
            return deny(NEED_ROLE);
        }
        return deny(NEED_ROLE); // delete
    },

    async reservations(env, a, spec) {
        if (!a.member) return deny(a.uid ? NEED_ROLE : NEED_LOGIN, a.uid ? 'FORBIDDEN' : 'UNAUTHORIZED');
        if (spec.op === 'insert') {
            const rows = rowsOf(spec.values);
            if (rows.length !== 1) return deny(NEED_ROLE);
            const v = { ...rows[0], kakao_id: a.uid };
            const s = TIMES.indexOf(String(v.start_time)), e = TIMES.indexOf(String(v.end_time));
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.res_date)) || s < 0 || e < s) return deny('날짜·시간이 올바르지 않습니다.', 'BAD_REQUEST');
            if (!a.mgr) {
                v.status = (e - s) > 1 ? 'pending' : 'approved';
                const max = new Date(Date.now() + 9 * 3600 * 1000); max.setUTCMonth(max.getUTCMonth() + 2);
                if (String(v.res_date) > max.toISOString().slice(0, 10)) return deny('일반 멤버는 오늘로부터 2개월 이내만 선예약할 수 있어요.');
                if (String(v.res_date) < kstToday()) return deny('지난 날짜는 예약할 수 없습니다.');
                const r = await sbFetch(env, `reservations?select=id&kakao_id=eq.${enc(a.uid)}&created_at=gte.${enc(new Date(Date.now() - 5 * 60 * 1000).toISOString())}&limit=1`);
                if (r.ok && ((await r.json().catch(() => [])) || []).length) return deny('예약은 5분에 1회만 가능해요. 잠시 후 다시 시도해주세요.', 'RATE_LIMIT');
            } else if (!['approved', 'pending'].includes(v.status)) v.status = 'approved';
            if (await slotTaken(env, v.res_date, v.start_time, v.end_time) === true) return deny(SLOT_TAKEN_MSG, 'SLOT_TAKEN');
            spec.values = Array.isArray(spec.values) ? [v] : v;
            return {};
        }
        if (spec.op === 'update') {
            const keys = Object.keys(rowsOf(spec.values)[0] || {});
            if (a.mgr) return {};
            return subset(keys, ['participant_ids', 'participant_etc']) ? {} : deny(NEED_ROLE);
        }
        if (spec.op === 'delete') return a.sup ? {} : { extra: [`kakao_id=eq.${enc(a.uid)}`] };
        return deny(NEED_ROLE);
    },

    async time_blocks(env, a, spec) {
        if (a.sup || a.bandAdmin) return {};
        const rows = spec.values != null ? rowsOf(spec.values) : [];
        if (spec.op === 'insert' && rows.length === 1) {
            const v = rows[0], reason = String(v.reason || '');
            if (a.bandOk && reason.startsWith('[고정팀 대체]') && !v.is_recurring) return {};
            if (reason.startsWith('[커뮤니티] ') && v.start_date && v.start_date === v.end_date && subset(Object.keys(v), ['day_of_week', 'start_time', 'end_time', 'reason', 'start_date', 'end_date'])) {
                // 방금 만든(공개 상태) 모임의 시간만 — 제목·날짜가 맞는 모임이 있어야 한다
                const r = await sbFetch(env, `community_meetings?select=id&meeting_date=eq.${enc(v.start_date)}&title=eq.${enc(reason.slice('[커뮤니티] '.length))}&limit=1`);
                if (r.ok && ((await r.json().catch(() => [])) || []).length) return {};
            }
        }
        if (spec.op === 'update' && a.bandOk && rows.length === 1 && subset(Object.keys(rows[0]), ['skip_dates'])) return {};
        if (spec.op === 'delete' && spec.filters.length === 2 && spec.filters.every(f => f[0] === 'eq')) {
            // 모임 삭제(비밀번호 확인은 DB RPC) 뒤 남은 차단 정리 — 그 제목·날짜의 모임이 더 없을 때만
            const reason = String(eqFilter(spec, 'reason') || ''), date = String(eqFilter(spec, 'start_date') || '');
            if (reason.startsWith('[커뮤니티] ') && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
                const r = await sbFetch(env, `community_meetings?select=id&meeting_date=eq.${enc(date)}&title=eq.${enc(reason.slice('[커뮤니티] '.length))}&limit=1`);
                if (r.ok && !((await r.json().catch(() => [1])) || []).length) return { extra: [`end_date=eq.${enc(date)}`] };
            }
        }
        return deny(a.uid ? NEED_ROLE : NEED_LOGIN, a.uid ? 'FORBIDDEN' : 'UNAUTHORIZED');
    },

    async performance_bookings(env, a, spec) {
        if (spec.op === 'select') return a.sup ? {} : deny(NEED_ROLE);
        if (spec.op === 'insert') {
            const rows = rowsOf(spec.values);
            if (rows.length !== 1) return deny(NEED_ROLE);
            const v = {}; for (const k of PERF_INSERT_COLS) if (k in rows[0]) v[k] = rows[0][k];
            const s = TIMES.indexOf(String(v.start_time)), e = TIMES.indexOf(String(v.end_time));
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date)) || s < 0 || e < s || String(v.date) < kstToday()) return deny('날짜·시간이 올바르지 않습니다.', 'BAD_REQUEST');
            if (!String(v.name || '').trim() || digits(v.phone).length < 9) return deny('이름과 연락처를 확인해주세요.', 'BAD_REQUEST');
            if (await slotTaken(env, v.date, v.start_time, v.end_time) === true) return deny(SLOT_TAKEN_MSG, 'SLOT_TAKEN');
            spec.values = Array.isArray(spec.values) ? [v] : v;
            if (spec.select && !subset(spec.select.replace(/\s+/g, '').split(','), ['id', 'booking_code'])) spec.select = 'id,booking_code';
            return {};
        }
        if (spec.op === 'update') {
            const v = rowsOf(spec.values)[0] || {};
            if (Object.keys(v).length === 1 && v.status === 'expired') // 4시간 자동취소 반영 — 누가 불러도 기한 지난 대기 건만
                return { extra: ['status=eq.pending', `created_at=lt.${enc(new Date(Date.now() - PERF_EXPIRE_MS).toISOString())}`] };
        }
        return a.sup ? {} : deny(a.uid ? NEED_ROLE : NEED_LOGIN, a.uid ? 'FORBIDDEN' : 'UNAUTHORIZED');
    },

    async comments(env, a, spec) {
        if (!a.member) return deny(a.uid ? NEED_ROLE : NEED_LOGIN, a.uid ? 'FORBIDDEN' : 'UNAUTHORIZED');
        if (spec.op === 'insert') { spec.values = Array.isArray(spec.values) ? spec.values.map(v => ({ ...v, kakao_id: a.uid })) : { ...spec.values, kakao_id: a.uid }; return {}; }
        if (spec.op === 'update') {
            const keys = Object.keys(rowsOf(spec.values)[0] || {});
            if (subset(keys, ['likes'])) return {};
            if (subset(keys, ['pinned', 'pinned_at'])) return a.mgr ? {} : deny(NEED_ROLE);
            if (subset(keys, ['content'])) return a.mgr ? {} : { extra: [`kakao_id=eq.${enc(a.uid)}`] };
            return deny(NEED_ROLE);
        }
        if (spec.op === 'delete') return a.mgr ? {} : { extra: [`kakao_id=eq.${enc(a.uid)}`] };
        return deny(NEED_ROLE);
    },

    async schedule_guests(env, a, spec) {
        if (!a.member) return deny(a.uid ? NEED_ROLE : NEED_LOGIN, a.uid ? 'FORBIDDEN' : 'UNAUTHORIZED');
        if (spec.op === 'insert') { const f = (v) => ({ ...v, host_profile_id: a.p.id }); spec.values = Array.isArray(spec.values) ? spec.values.map(f) : f(spec.values); return {}; }
        return a.mgr ? {} : { extra: [`host_profile_id=eq.${a.p.id}`] };
    },
};
const memberOnly = async (env, a) => (a.member ? {} : deny(a.uid ? NEED_ROLE : NEED_LOGIN, a.uid ? 'FORBIDDEN' : 'UNAUTHORIZED'));
const roleOnly = (flag) => async (env, a) => (a[flag] ? {} : deny(a.uid ? NEED_ROLE : NEED_LOGIN, a.uid ? 'FORBIDDEN' : 'UNAUTHORIZED'));
POLICY.schedule_attendees = memberOnly;
POLICY.teams = memberOnly;
POLICY.poll_votes = memberOnly;
POLICY.polls = roleOnly('mgr');
POLICY.schedules = roleOnly('mgr');
POLICY.documents = roleOnly('mgr');
POLICY.notices = roleOnly('lead');

async function dbAction(env, actors, body) {
    const table = String(body.table || '');
    const policy = POLICY[table];
    if (!policy) return deny('지원하지 않는 요청입니다.', 'BAD_TABLE');
    let first = null;
    for (const actor of actors) {
        let spec;
        try { spec = parseCalls(body.calls); } catch (e) { return deny('잘못된 요청입니다. (' + e.message + ')', 'BAD_REQUEST'); }
        if (spec.op === 'select' && table !== 'profiles' && table !== 'performance_bookings') return deny('지원하지 않는 요청입니다.', 'BAD_TABLE');
        const verdict = await policy(env, actor, spec);
        if (verdict.error) { first = first || verdict; continue; }
        const out = await execSpec(env, table, spec, (verdict.extra || []).filter(Boolean));
        if (!out.error && verdict.post && out.data) out.data = Array.isArray(out.data) ? verdict.post(out.data) : verdict.post([out.data])[0];
        return out;
    }
    return first;
}

const SPACE_KEYS = ['door_1f', 'door_b1', 'ops_contact', 'sound_contact']; // js/app-6-band.js BAND_SETTING_KEYS 와 같은 목록
const maskEmail = (email) => {
    const [local, domain] = String(email).split('@');
    const masked = local.length <= 2 ? local[0] + '**' : local.slice(0, 2) + '*'.repeat(Math.min(local.length - 2, 4));
    return masked + '@' + (domain || '');
};

export async function handle(env, body) {
    const action = String(body.action || '');
    if (action === 'ping') return [200, { ok: true }];

    if (action === 'login') {
        const kid = await verifyKakao(body.kakao_token);
        if (!kid) return [401, { ok: false, error: 'unauthorized', message: '카카오 로그인을 확인하지 못했습니다.' }];
        const r = await sbFetch(env, `profiles?select=*&kakao_id=eq.${enc(kid)}&limit=1`);
        const profile = r.ok ? (((await r.json().catch(() => [])) || [])[0] || null) : null;
        const s = await signSession(env, kid);
        return [200, { ok: true, session: s.session, exp: s.exp, kakao_id: kid, profile }];
    }

    if (action === 'perf_lookup' || action === 'perf_cancel') {
        const phone = digits(body.phone);
        if (phone.length < 10) return [400, { ok: false, error: 'bad_request', message: '연락처를 정확히 입력해주세요.' }];
        const cols = 'id,name,booking_code,phone,status,date,start_time,end_time,headcount,purpose,created_at';
        let filter;
        if (action === 'perf_lookup') {
            const code = String(body.code || '').trim().toUpperCase();
            if (!/^[A-Z2-9]{6}$/.test(code)) return [400, { ok: false, error: 'bad_request', message: '예약번호 6자리를 입력해주세요.' }];
            filter = `booking_code=eq.${code}`;
        } else {
            if (!isUuid(body.id)) return [400, { ok: false, error: 'bad_request', message: '잘못된 요청입니다.' }];
            filter = `id=eq.${body.id}`;
        }
        const r = await sbFetch(env, `performance_bookings?select=${cols}&${filter}&limit=1`);
        if (!r.ok) return [500, { ok: false, error: 'db', message: '조회 중 오류가 발생했습니다.' }];
        const b = ((await r.json().catch(() => [])) || [])[0];
        if (!b || digits(b.phone) !== phone) return [200, { ok: true, booking: null }]; // 불일치 시 존재 여부도 알리지 않는다
        if (action === 'perf_lookup') return [200, { ok: true, booking: b }];
        const u = await sbFetch(env, `performance_bookings?id=eq.${b.id}&status=in.(pending,approved)&select=id`, {
            method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'cancelled' }) });
        if (!u.ok) return [500, { ok: false, error: 'db', message: '취소 중 오류가 발생했습니다.' }];
        const done = (await u.json().catch(() => [])) || [];
        return [200, { ok: true, cancelled: done.length > 0 }];
    }

    if (action === 'find_id') {
        const name = String(body.name || '').trim(), phone = String(body.phone || '').trim();
        if (!name || digits(phone).length < 9) return [400, { ok: false, error: 'bad_request', message: '이름과 전화번호를 입력해주세요.' }];
        const r = await sbFetch(env, `profiles?select=email,phone&name=eq.${enc(name)}&limit=20`);
        const rows = r.ok ? ((await r.json().catch(() => [])) || []) : [];
        const hit = rows.find(p => p.email && digits(p.phone) === digits(phone));
        return [200, { ok: true, masked: hit ? maskEmail(hit.email) : null }];
    }

    const { bad, actors } = await resolveActors(env, body);
    if (bad) return [401, { ok: false, error: 'unauthorized', message: NEED_LOGIN }];
    const actor = actors.find(x => x.kid) || actors[0];

    // ── 이메일 계정 ↔ 카카오 계정 연결(2026-11-23) ──
    // kakao_link_self: 「이메일 계정의 주인」임을 Supabase 세션으로, 「카카오 계정의 주인」임을 카카오 토큰(또는 서버 세션)으로 둘 다 증명해야 연결한다.
    //   마이 › 카카오 계정 연결(이메일 로그인 상태에서 카카오 팝업) · 카카오 첫 로그인 모달 「기존 계정 연동」(이메일+비밀번호) 두 화면이 쓴다.
    if (action === 'kakao_link_self') {
        const kidActor = actors.find(x => x.kid), sbActor = actors.find(x => x.sbUid);
        if (!kidActor || !sbActor) return [401, { ok: false, error: 'unauthorized', message: '이메일 계정과 카카오 계정 둘 다 확인이 필요합니다. 다시 시도해주세요.' }];
        const p = sbActor.p;
        if (!p || p.member_type === 'band') return [400, { ok: false, error: 'not_member', message: '게더링 이메일 계정만 카카오와 연결할 수 있습니다.' }];
        if (p.status === 'rejected') return [403, { ok: false, error: 'forbidden', message: NEED_ROLE }];
        const kid = kidActor.kid;
        if (p.kakao_id && String(p.kakao_id) !== kid) return [409, { ok: false, error: 'linked_other', message: '이 계정은 이미 다른 카카오 계정과 연결되어 있습니다. 바꾸려면 운영진에게 문의해주세요.' }];
        if (kidActor.p && kidActor.p.id !== p.id) return [409, { ok: false, error: 'kakao_taken', message: '이 카카오 계정은 이미 다른 게더링 계정(카카오로 가입·신청한 계정)에 연결되어 있습니다. 운영진에게 문의해주세요.' }];
        if (!p.kakao_id) {
            const u = await sbFetch(env, `profiles?id=eq.${p.id}&kakao_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ kakao_id: kid }) });
            const done = u.ok ? ((await u.json().catch(() => [])) || []) : [];
            if (!done.length) return [500, { ok: false, error: 'db', message: '연결하지 못했습니다. 잠시 후 다시 시도해주세요.' }];
        }
        const moved = await syncIdentity(env, p.id, kid);
        return [200, { ok: true, linked: true, kakao_id: kid, status: p.status, moved }];
    }
    // identity_sync: 이미 연결된 계정의 옛 기록(이메일 로그인 때 계정 id 로 남긴 예약·게시글)을 카카오 ID 로 옮긴다 — 이메일 로그인 때 브라우저가 한 번 부른다.
    if (action === 'identity_sync') {
        const sbActor = actors.find(x => x.sbUid);
        if (!sbActor || !sbActor.p) return [401, { ok: false, error: 'unauthorized', message: NEED_LOGIN }];
        const p = sbActor.p;
        if (p.member_type === 'band' || !p.kakao_id) return [200, { ok: true, moved: 0 }];
        return [200, { ok: true, moved: await syncIdentity(env, p.id, String(p.kakao_id)) }];
    }

    // kakao_link(옛 방식: 이름+전화번호) — 이메일 로그인 계정이 있는 프로필은 더 이상 이 방법으로 연결하지 않는다
    // (이름·연락처만 알면 남의 계정에 자기 카카오를 붙일 수 있었다, 2026-11-23). 로그인 수단이 없는 프로필만 종전대로.
    if (action === 'kakao_link') {
        if (!actor.kid) return [401, { ok: false, error: 'unauthorized', message: NEED_LOGIN }];
        if (actor.p) return [409, { ok: false, error: 'exists', message: '이미 연결된 계정이 있습니다.' }];
        const name = String(body.name || '').trim(), phone = digits(body.phone);
        if (!name || phone.length < 9) return [400, { ok: false, error: 'bad_request', message: '이름과 전화번호를 확인해주세요.' }];
        const r = await sbFetch(env, `profiles?select=id,phone,member_type&name=eq.${enc(name)}&kakao_id=is.null&limit=20`);
        const rows = r.ok ? ((await r.json().catch(() => [])) || []) : [];
        const match = rows.find(p => digits(p.phone) === phone && p.member_type !== 'band');
        if (!match) return [200, { ok: true, linked: false }];
        if (await hasAuthUser(env, match.id)) return [200, { ok: false, error: 'need_login', message: '이메일로 가입한 계정은 이메일·비밀번호로 연결해주세요. 화면을 새로고침한 뒤 다시 시도해주세요.' }];
        const u = await sbFetch(env, `profiles?id=eq.${match.id}&kakao_id=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kakao_id: actor.kid }) });
        if (!u.ok) return [500, { ok: false, error: 'db', message: '연동하지 못했습니다.' }];
        return [200, { ok: true, linked: true }];
    }

    // ── 회원 탈퇴 · 거절된 멤버 삭제(2026-11-24) — DB 함수 gaa_delete_profile 로 한 번에 ──
    // profile_withdraw {profile_id}: 로그인한 본인 프로필만(게더링 계정, 운영 총괄은 역할을 넘긴 뒤).
    // profile_delete {ids[]}: 운영 총괄만, **거절(차단) 상태인 게더링 계정만** — 승인·대기 계정은 여기서 못 지운다.
    if (action === 'profile_withdraw' || action === 'profile_delete') {
        const NO_FN = '이 기능을 쓰려면 Supabase SQL Editor 에서 20261124_profile_delete.sql 을 한 번 실행해야 합니다.';
        // 프로필 하나 삭제 → {ok} | {ok:false, error, message}
        const removeOne = async (p) => {
            const r = await sbFetch(env, 'rpc/gaa_delete_profile', { method: 'POST', body: JSON.stringify({ p_id: p.id }) });
            if (!r.ok) {
                const why = (await r.text().catch(() => '')).slice(0, 400);
                if (r.status === 404 || /PGRST202|could not find the function/i.test(why)) return { ok: false, error: 'no_function', message: NO_FN };
                if (/PROFILE_DELETE_NOT_FOUND/.test(why)) return { ok: true, gone: true }; // 이미 없음
                console.error(action + ' 실패:', r.status, why);
                return { ok: false, error: 'db', message: '처리하지 못했습니다. 아무것도 바뀌지 않았습니다. 잠시 후 다시 시도해주세요.' };
            }
            const out = await r.json().catch(() => null) || {};
            // DB 함수가 이메일 로그인 계정을 못 지웠으면(권한) 관리 API 로 지운다 — 남으면 같은 이메일로 다시 가입할 수 없다
            let authLeft = false;
            if (out.auth === 'failed' && isUuid(p.id)) {
                try {
                    const d = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } });
                    authLeft = !(d.ok || d.status === 404);
                } catch (_) { authLeft = true; }
                if (authLeft) console.error(action + ': 로그인 계정 삭제 실패', p.id);
            }
            // 프로필 사진 파일(community-images/avatars/<id>-<ts>.jpg) — 있으면 지운다(실패해도 탈퇴는 끝난 것)
            try {
                const m = String(p.avatar_url || '').match(/\/community-images\/(avatars\/[A-Za-z0-9._-]+)$/);
                if (m && m[1].startsWith(`avatars/${p.id}-`)) {
                    await fetch(`${env.SUPABASE_URL}/storage/v1/object/community-images/${m[1]}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } });
                }
            } catch (_) {}
            return { ok: true, auth_left: authLeft };
        };

        if (action === 'profile_withdraw') {
            const me = actors.find(x => x.p && x.p.id === String(body.profile_id || ''));
            if (!me) return [actors.some(x => x.uid) ? 403 : 401, { ok: false, error: 'forbidden', message: '본인 계정만 탈퇴할 수 있습니다. 다시 로그인한 뒤 시도해주세요.' }];
            if (me.p.member_type === 'band') return [400, { ok: false, error: 'band', message: '합주팀 계정은 여기서 탈퇴할 수 없습니다. 운영진에게 문의해주세요.' }];
            if (me.sup) return [400, { ok: false, error: 'sup', message: '운영 총괄은 다른 멤버에게 운영 총괄 역할을 넘긴 뒤 탈퇴할 수 있습니다.' }];
            const out = await removeOne(me.p);
            if (!out.ok) return [out.error === 'no_function' ? 200 : 500, out];
            return [200, { ok: true, withdrawn: true, auth_left: !!out.auth_left }];
        }

        if (!actors.some(x => x.sup)) return [actors.some(x => x.uid) ? 403 : 401, { ok: false, error: 'forbidden', message: NEED_ROLE }];
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))];
        if (!ids.length || ids.length > 100 || !ids.every(isUuid)) return [400, { ok: false, error: 'bad_request', message: '삭제할 계정을 확인해주세요.' }];
        const r = await sbFetch(env, `profiles?select=*&id=in.(${ids.join(',')})`);
        const rows = r.ok ? ((await r.json().catch(() => [])) || []) : [];
        const myIds = new Set(actors.filter(x => x.p).map(x => x.p.id));
        const targets = rows.filter(p => p.status === 'rejected' && p.member_type !== 'band' && !myIds.has(p.id));
        if (!targets.length) return [409, { ok: false, error: 'not_rejected', message: '거절(차단) 상태인 계정만 삭제할 수 있습니다. 목록을 새로고침해주세요.' }];
        let deleted = 0;
        for (const p of targets) {
            const out = await removeOne(p);
            if (!out.ok) return [out.error === 'no_function' ? 200 : 500, { ...out, deleted }];
            deleted++;
        }
        return [200, { ok: true, deleted, skipped: ids.length - deleted }];
    }

    // ── 계정 통합(운영 총괄만, 2026-11-23) — 같은 사람의 두 게더링 프로필을 하나로 ──
    // {a_id, b_id, dry:true[, keep_id]} → 계획(어느 쪽이 남는지·왜)만.  {keep_id, drop_id} → DB 함수 gaa_merge_profiles 로 한 번에 실행.
    // 남길 쪽 규칙: 이메일 로그인 계정이 있는 쪽(없앨 쪽에 로그인이 있으면 그 로그인이 갈 곳을 잃는다) → 둘 다 없으면 역할 높은 쪽 → 먼저 가입한 쪽.
    if (action === 'profile_merge') {
        const sup = actors.find(x => x.sup);
        if (!sup) return [actors.some(x => x.uid) ? 403 : 401, { ok: false, error: 'forbidden', message: NEED_ROLE }];
        const dry = !!body.dry;
        const idA = String((dry ? body.a_id : body.keep_id) || ''), idB = String((dry ? body.b_id : body.drop_id) || '');
        if (!isUuid(idA) || !isUuid(idB) || idA.toLowerCase() === idB.toLowerCase()) return [400, { ok: false, error: 'bad_request', message: '통합할 두 계정을 확인해주세요.' }];
        const [pa, pb] = await Promise.all([profileBy(env, `id=eq.${idA}`), profileBy(env, `id=eq.${idB}`)]);
        if (!pa || !pb) return [404, { ok: false, error: 'not_found', message: '계정을 찾지 못했습니다. 목록을 새로고침한 뒤 다시 시도해주세요.' }];
        if (pa.member_type === 'band' || pb.member_type === 'band') return [400, { ok: false, error: 'band', message: '합주팀 계정은 통합할 수 없습니다.' }];
        const [la, lb] = await Promise.all([hasAuthUser(env, pa.id), hasAuthUser(env, pb.id)]);
        const view = (p, login) => ({ id: p.id, name: p.name || '', email: p.email || '', phone: p.phone || '', role: p.role || '일반', status: p.status || '', created_at: p.created_at || null, kakao: !!p.kakao_id, login });
        if (dry) {
            if (la && lb) return [409, { ok: false, error: 'both_login', message: '두 계정 모두 이메일 로그인 계정이라 통합할 수 없습니다. (한쪽이 카카오로만 가입한 계정이어야 합니다)' }];
            const rank = (p) => ['일반', '세션장', '총괄', '운영 총괄'].indexOf(p.role || '일반');
            let keepA;
            if (la !== lb) keepA = la;                                                 // 로그인 있는 쪽을 남긴다(고를 수 없음)
            else if (body.keep_id === pa.id || body.keep_id === pb.id) keepA = body.keep_id === pa.id; // 운영자가 고른 쪽
            else if (rank(pa) !== rank(pb)) keepA = rank(pa) > rank(pb);
            else keepA = String(pa.created_at || '') <= String(pb.created_at || '');
            const keep = keepA ? pa : pb, drop = keepA ? pb : pa;
            if (sup.p && sup.p.id === drop.id) return [400, { ok: false, error: 'self', message: '지금 로그인한 본인 계정은 없앨 수 없습니다. 본인 계정을 남기는 쪽으로 통합해주세요.' }];
            return [200, { ok: true, dry: true, keep: view(keep, keepA ? la : lb), drop: view(drop, keepA ? lb : la), swappable: la === lb,
                kakao_lost: !!(keep.kakao_id && drop.kakao_id && String(keep.kakao_id) !== String(drop.kakao_id)) }];
        }
        if (lb) return [409, { ok: false, error: 'drop_has_login', message: '없앨 계정에 이메일 로그인이 있습니다. 그 계정을 남기는 쪽으로 통합해주세요.' }];
        if (sup.p && sup.p.id === pb.id) return [400, { ok: false, error: 'self', message: '지금 로그인한 본인 계정은 없앨 수 없습니다.' }];
        const r = await sbFetch(env, 'rpc/gaa_merge_profiles', { method: 'POST', body: JSON.stringify({ p_keep: pa.id, p_drop: pb.id }) });
        if (!r.ok) {
            const why = (await r.text().catch(() => '')).slice(0, 400);
            if (r.status === 404 || /PGRST202|could not find the function/i.test(why)) return [200, { ok: false, error: 'no_function', message: '통합 기능을 쓰려면 Supabase SQL Editor 에서 20261123_profile_merge.sql 을 한 번 실행해야 합니다.' }];
            if (/MERGE_DROP_HAS_LOGIN/.test(why)) return [409, { ok: false, error: 'drop_has_login', message: '없앨 계정에 이메일 로그인이 있습니다. 그 계정을 남기는 쪽으로 통합해주세요.' }];
            if (/MERGE_NOT_FOUND/.test(why)) return [404, { ok: false, error: 'not_found', message: '계정을 찾지 못했습니다. 목록을 새로고침한 뒤 다시 시도해주세요.' }];
            console.error('profile_merge 실패:', r.status, why);
            return [500, { ok: false, error: 'db', message: '통합하지 못했습니다. 아무것도 바뀌지 않았습니다. 잠시 후 다시 시도해주세요.' }];
        }
        const out = await r.json().catch(() => null) || {};
        return [200, { ok: true, merged: true, keep_id: pa.id, kakao_linked: !!out.kakao_linked, moved: out.moved || {} }];
    }

    // ── 공간 이용 안내의 「로그인한 사람에게만 보일 값」(출입 번호·담당자 연락처, 표 band_settings — 합주팀 운영 안내와 같은 값) ──
    //   읽기: 승인된 게더링 멤버 · 쓰기: 운영 총괄. 표가 없으면(마이그레이션 전) 빈 값 + missing.
    if (action === 'space_info' || action === 'space_info_save') {
        const okRead = actors.some(x => x.member || x.sup);
        if (!okRead) return [actors.some(x => x.uid) ? 403 : 401, { ok: false, error: 'forbidden', message: '승인된 멤버만 볼 수 있습니다.' }];
        if (action === 'space_info_save') {
            if (!actors.some(x => x.sup)) return [403, { ok: false, error: 'forbidden', message: NEED_ROLE }];
            const src = body.settings && typeof body.settings === 'object' ? body.settings : {};
            const now = new Date().toISOString();
            const rows = SPACE_KEYS.map(k => ({ key: k, value: String(src[k] == null ? '' : src[k]).trim().slice(0, 60), updated_at: now }));
            const w = await sbFetch(env, 'band_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
            if (!w.ok) {
                const t = await w.text().catch(() => '');
                if (w.status === 404 || /band_settings|PGRST205|42P01/.test(t)) return [409, { ok: false, error: 'no_table', message: '저장 표가 없습니다 — Supabase SQL Editor 에서 20261124_band_settings.sql 을 실행해주세요.' }];
                console.error('space_info_save 실패:', w.status, t.slice(0, 200));
                return [500, { ok: false, error: 'save_failed', message: '저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }];
            }
            return [200, { ok: true, settings: Object.fromEntries(rows.map(r => [r.key, r.value])) }];
        }
        const r = await sbFetch(env, 'band_settings?select=key,value');
        if (!r.ok) return [200, { ok: true, missing: true, settings: {} }];
        const settings = {};
        ((await r.json().catch(() => [])) || []).forEach(x => { if (SPACE_KEYS.includes(x.key)) settings[x.key] = String(x.value || ''); });
        return [200, { ok: true, settings }];
    }

    // ── 운영 도구(운영 총괄만): 브라우저 오류 기록 · 백업 내려받기 ──
    if (action === 'client_errors' || action === 'client_errors_clear' || action === 'backup_tables' || action === 'backup_table') {
        if (!actors.some(x => x.sup)) return [actors.some(x => x.uid) ? 403 : 401, { ok: false, error: 'forbidden', message: NEED_ROLE }];
        if (action === 'client_errors') {
            const r = await sbFetch(env, 'client_errors?select=*&order=created_at.desc&limit=200');
            if (!r.ok) return [200, { ok: true, missing: true, rows: [] }]; // 표 없음(마이그레이션 전)
            return [200, { ok: true, rows: (await r.json().catch(() => [])) || [] }];
        }
        if (action === 'client_errors_clear') {
            const r = await sbFetch(env, 'client_errors?id=gt.0', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
            return [r.ok ? 200 : 500, { ok: r.ok }];
        }
        if (action === 'backup_tables') return [200, { ok: true, tables: BACKUP_TABLES, page: BACKUP_PAGE }];
        const table = String(body.table || '');
        if (!BACKUP_TABLES.includes(table)) return [400, { ok: false, error: 'bad_table', message: '백업 대상이 아닙니다.' }];
        const offset = Math.max(0, parseInt(body.offset, 10) || 0);
        const r = await sbFetch(env, `${table}?select=*&limit=${BACKUP_PAGE}&offset=${offset}`);
        if (!r.ok) return [200, { ok: true, missing: true, rows: [] }]; // 표가 없는 환경은 건너뛴다
        const rows = (await r.json().catch(() => [])) || [];
        return [200, { ok: true, rows, more: rows.length === BACKUP_PAGE }];
    }

    if (action === 'db') return [200, await dbAction(env, actors, body)];
    return [400, { ok: false, error: 'bad_action', message: '지원하지 않는 요청입니다.' }];
}

export async function onRequestOptions({ request }) {
    return new Response(null, { status: 204, headers: corsFor(request.headers.get('Origin') || '') });
}
export async function onRequestPost({ request, env }) {
    const cors = corsFor(request.headers.get('Origin') || '');
    const send = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!fromOurSite(request)) return send(403, { ok: false, error: 'forbidden', message: '허용되지 않은 출처입니다.' });
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return send(500, { ok: false, error: 'config', message: '서버 설정이 필요합니다.' });
    let body;
    try { body = await request.json(); } catch (_) { return send(400, { ok: false, error: 'bad_request', message: '잘못된 요청입니다.' }); }
    if (!body || typeof body !== 'object') return send(400, { ok: false, error: 'bad_request', message: '잘못된 요청입니다.' });
    try {
        const [status, obj] = await handle(env, body);
        return send(status, obj);
    } catch (e) {
        console.error('gatheo-api:', e && e.stack || e);
        return send(500, { ok: false, error: 'server', message: '서버 오류가 발생했습니다.' });
    }
}
