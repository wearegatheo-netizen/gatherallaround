// Cloudflare Pages Function: /wappen-api
// 와펜 꾸미기(/wappen/)의 유일한 쓰기 경로 (service role).
// 클라이언트(anon)는 공개 프로젝트·작품·와펜 읽기와 wappen_ranking RPC 만 가능 — RLS가 나머지를 전면 차단하므로
// 로그인·업로드 서명·프로젝트/작품 저장·반응·신고·요청·관리자 작업은 전부 이 함수를 거친다.
//
// 인증: 카카오 access token 은 `login` 한 번만 kapi 에서 검증하고, 이후에는 서버가 발급한 세션 토큰(30일)을
//       body.session 으로 받는다 (DB 에는 sha256 해시만 저장). 차단(is_banned) 사용자는 쓰기 403.
// 업로드: 바이트를 프록시하지 않는다. 서버가 종류별 경로·권한을 정해 Supabase Storage 서명 업로드 URL 만 발급하고
//       클라이언트가 직접 PUT 한다. 이후 저장 액션에서 URL 접두(버킷/종류/사용자) 를 재검증.
//
// 에러 응답 규약: { ok:false, error:'<기계코드>', message:'<사용자 문구>' }
//   400 형식 오류 / 401 세션·카카오 토큰 무효 / 403 출처·권한·차단 / 404 없음 / 409 충돌 / 429 한도 / 500 upstream
//   (Cloudflare 가 502 본문을 가리므로 upstream 실패도 500 으로 낸다 — CLAUDE.md)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (기존 /event-api 등과 공유)

import { presetOf, isValidSize, REACTION_KEYS, REPORT_REASONS, LAYOUT, LIMITS } from '../wappen/presets.js';
import { SEED_ITEMS, SEED_VERSION } from '../wappen/seed/manifest.js';

// 기본 와펜 세트 — 저장소의 정적 파일(wappen/seed/*.png, tools/wappen-seed 가 생성한 원본 그림)을 그대로 가리킨다.
// 스토리지 복사 없이 행만 넣으므로 서브리퀘스트 2번이면 끝. 같은 이미지 URL 이 이미 있으면 건너뛴다(여러 번 눌러도 중복 없음).
const SEED_BASE = 'https://gatherallaround.com/wappen/seed/';

const ADMIN_KAKAO_ID = '4883868250'; // index.html ADMIN_ID / event-api ADMIN_KAKAO_ID 와 동일 — 관리자 백스톱
const SESSION_DAYS = 30;
const BUCKET = 'wappen';
const REPORT_REASON_KEYS = REPORT_REASONS.map(r => r.key);

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

// 우리 사이트에서 온 요청인가 (music-search.js 와 동일 규칙) — 스크립트 남용 1차 차단
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
const sbDetail = async (r) => (await r.text().catch(() => '')).slice(0, 300);

const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const DUP_PROJECT = '같은 이름의 프로젝트가 이미 있어요. 다른 이름을 입력해주세요.';
const DUP_WORK = '이 프로젝트에 같은 이름의 작품이 이미 있어요. 다른 이름을 입력해주세요.';
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const intIn = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const nowIso = () => new Date().toISOString();
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
const DAY = 86400e3;

async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function newToken() {
    const b = crypto.getRandomValues(new Uint8Array(32));
    let bin = ''; for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── 카카오 토큰 검증 (event-api 와 동일 + 프로필 사진) ──
async function verifyKakao(token) {
    if (!token || typeof token !== 'string' || token.length > 512) return null;
    try {
        const r = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        if (!u || !u.id) return null;
        const prof = (u.kakao_account && u.kakao_account.profile) || {};
        const props = u.properties || {};
        const nickname = prof.nickname || props.nickname || '';
        const avatar = prof.thumbnail_image_url || prof.profile_image_url || props.thumbnail_image || props.profile_image || null;
        return { id: String(u.id), nickname, avatar: avatar && /^https?:\/\//.test(avatar) ? avatar : null };
    } catch (_) { return null; }
}

// 클라이언트에 돌려주는 사용자 모양 — kakao_id 는 내보내지 않는다
const pubUser = (u) => ({
    id: u.id, nickname: u.nickname, avatar_url: u.avatar_url || null,
    is_admin: !!u.is_admin || u.kakao_id === ADMIN_KAKAO_ID, is_banned: !!u.is_banned,
    created_at: u.created_at, last_login_at: u.last_login_at,
});

// 세션 토큰 → 사용자. 만료면 행을 지우고 null.
async function authSession(env, token) {
    if (!token || typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
    const hash = await sha256Hex(token);
    const r = await sbFetch(env, `wappen_sessions?token_hash=eq.${hash}&select=token_hash,expires_at,last_seen_at,wappen_users(*)&limit=1`);
    if (!r.ok) throw new Error('session lookup failed: ' + r.status + ' ' + await sbDetail(r));
    const s = (await r.json())[0];
    if (!s || !s.wappen_users) return null;
    if (new Date(s.expires_at).getTime() < Date.now()) {
        await sbFetch(env, `wappen_sessions?token_hash=eq.${hash}`, { method: 'DELETE' }).catch(() => {});
        return null;
    }
    // last_seen_at 은 1시간에 한 번만 갱신(쓰기 절약)
    if (!s.last_seen_at || Date.now() - new Date(s.last_seen_at).getTime() > 3600e3) {
        await sbFetch(env, `wappen_sessions?token_hash=eq.${hash}`, { method: 'PATCH', body: JSON.stringify({ last_seen_at: nowIso() }) }).catch(() => {});
    }
    const u = s.wappen_users;
    return { user: { ...u, is_admin: !!u.is_admin || u.kakao_id === ADMIN_KAKAO_ID }, tokenHash: hash };
}

// 행 수 세기 — PostgREST count=exact (Range 0-0 로 본문 최소화)
async function countRows(env, pathQuery) {
    const r = await sbFetch(env, pathQuery, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    if (!r.ok && r.status !== 206) throw new Error('count failed: ' + r.status + ' ' + await sbDetail(r));
    const range = r.headers.get('content-range') || '*/0';
    return parseInt(range.split('/')[1] || '0', 10) || 0;
}

// auth_attempts 기반 호출 한도 (verify-community-admin 과 같은 테이블). 문제 시 통과(가용성 우선).
async function rateLimited(env, scope, key, max, windowMs) {
    try {
        const since = new Date(Date.now() - windowMs).toISOString();
        const total = await countRows(env, `auth_attempts?scope=eq.${encodeURIComponent(scope)}&ip=eq.${encodeURIComponent(key)}&created_at=gte.${since}&select=id`);
        if (total >= max) return true;
        await sbFetch(env, 'auth_attempts', { method: 'POST', body: JSON.stringify({ scope, ip: key }) }).catch(() => {});
        return false;
    } catch (_) { return false; }
}
const clientIp = (request) => request.headers.get('cf-connecting-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

// 우리 버킷의 지정 접두로 시작하는 공개 URL 인가 (event-api posterOk 방식)
function storageUrlOk(env, url, prefix) {
    const u = String(url || '');
    if (!u || u.length > 400 || /[?#\s]/.test(u) || u.includes('..')) return false;
    return u.startsWith(`${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${prefix}`);
}
const publicUrl = (env, path) => `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

// 업로드 종류 → 경로 접두·허용 확장자·권한
const UPLOAD_KINDS = {
    base:        { prefix: (u) => `base/${u.id}/`,     exts: ['jpg', 'png', 'webp'] },
    thumb:       { prefix: (u) => `thumbs/${u.id}/`,   exts: ['jpg', 'webp'] },
    preview:     { prefix: (u) => `previews/${u.id}/`, exts: ['jpg', 'webp'] },
    request_ref: { prefix: (u) => `requests/${u.id}/`, exts: ['jpg', 'png', 'webp'] },
    item:        { prefix: () => 'items/',             exts: ['png'], admin: true },
};
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// 레이아웃 스키마 검증 — 숫자 범위·개수·id 형식. 알 수 없는 키는 버린다.
function validateLayout(raw) {
    if (!raw || typeof raw !== 'object' || Number(raw.v) !== LAYOUT.version || !Array.isArray(raw.items)) return { error: '레이아웃 형식이 올바르지 않습니다.' };
    if (raw.items.length > LAYOUT.maxItems) return { error: `와펜은 최대 ${LAYOUT.maxItems}개까지 붙일 수 있습니다.` };
    const num = (v, [lo, hi]) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1e5) / 1e5 : null; };
    const items = [];
    for (const it of raw.items) {
        if (!it || !isUuid(it.id)) return { error: '레이아웃에 잘못된 와펜 id 가 있습니다.' };
        const x = num(it.x, LAYOUT.pos), y = num(it.y, LAYOUT.pos), w = num(it.w, LAYOUT.width), r = num(it.r == null ? 0 : it.r, LAYOUT.rot);
        if (x === null || y === null || w === null || r === null) return { error: '레이아웃 좌표가 허용 범위를 벗어났습니다.' };
        items.push({ id: String(it.id).toLowerCase(), x, y, w, r, fx: !!it.fx });
    }
    return { layout: { v: LAYOUT.version, items } };
}

// 레이아웃의 와펜 id 가 모두 존재하는지 (50개씩 in.() — 요청 줄 길이 제한 회피)
async function itemsExist(env, ids) {
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i += 50) {
        const chunk = uniq.slice(i, i + 50);
        const r = await sbFetch(env, `wappen_items?id=in.(${chunk.join(',')})&select=id`);
        if (!r.ok) throw new Error('items lookup failed: ' + r.status);
        const found = new Set((await r.json()).map(x => x.id));
        if (chunk.some(id => !found.has(id))) return false;
    }
    return true;
}

// 제목 중복 판정 키 — 앞뒤 공백·연속 공백·대소문자 무시 (DB 유일 인덱스 wappen_title_key() 와 같은 규칙)
const titleKey = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
// ilike 후보 패턴: 와일드카드 이스케이프(\ % _), * 는 PostgREST 가 % 로 바꾸므로 한 글자 와일드카드 _ 로(상위집합), 공백은 % 로(연속 공백 차이 흡수)
const ilikePattern = (s) => titleKey(s).replace(/[\\%_]/g, m => '\\' + m).replace(/\*/g, '_').replace(/ /g, '%');
// 같은 이름이 이미 있는지 — ilike 로 후보를 좁힌 뒤 titleKey 로 정확 비교. extra: 추가 필터(예: &project_id=eq.…), exclude: 자기 자신 id
async function titleTaken(env, table, title, { extra = '', exclude = null } = {}) {
    const r = await sbFetch(env, `${table}?select=id,title&title=ilike.${encodeURIComponent(ilikePattern(title))}${extra}&limit=50`);
    if (!r.ok) throw new Error(`${table} title lookup failed: ` + r.status + ' ' + await sbDetail(r));
    const key = titleKey(title);
    return (await r.json()).some(x => x.id !== exclude && titleKey(x.title) === key);
}
// 기본 제목이 겹치면 "이름 (2)", "이름 (3)" … 비어 있는 번호를 붙인다 (한 번의 ilike 'base%' 조회로 계산)
async function uniqueTitle(env, table, base, { extra = '', exclude = null } = {}) {
    const r = await sbFetch(env, `${table}?select=id,title&title=ilike.${encodeURIComponent(ilikePattern(base) + '%')}${extra}&limit=500`);
    if (!r.ok) throw new Error(`${table} title lookup failed: ` + r.status + ' ' + await sbDetail(r));
    const taken = new Set((await r.json()).filter(x => x.id !== exclude).map(x => titleKey(x.title)));
    if (!taken.has(titleKey(base))) return base;
    for (let n = 2; n < 1000; n++) { const cand = `${base.slice(0, LIMITS.title - String(n).length - 3)} (${n})`; if (!taken.has(titleKey(cand))) return cand; }
    return `${base.slice(0, LIMITS.title - 7)} ${Date.now() % 1e6}`;
}
// 작품 레이아웃이 참조하는 와펜 id 들 — or=(layout.cs.{…},…) 로 한 요청에 30개씩 (단일 항목 JSON 엔 쉼표·괄호가 없어 or 파서에 안전)
async function usedItemIds(env, ids) {
    const used = new Set(), want = new Set(ids);
    for (let i = 0; i < ids.length; i += 30) {
        const or = ids.slice(i, i + 30).map(id => `layout.cs.${JSON.stringify({ items: [{ id }] })}`).join(',');
        const r = await sbFetch(env, `wappen_works?select=layout&or=(${encodeURIComponent(or)})&limit=5000`);
        if (!r.ok) throw new Error('works lookup failed: ' + r.status + ' ' + await sbDetail(r));
        for (const w of await r.json()) for (const it of (w.layout && w.layout.items) || []) if (want.has(it.id)) used.add(it.id);
    }
    return used;
}

async function getOne(env, table, id, select = '*') {
    const r = await sbFetch(env, `${table}?id=eq.${id}&select=${encodeURIComponent(select)}&limit=1`);
    if (!r.ok) throw new Error(`${table} lookup failed: ` + r.status + ' ' + await sbDetail(r));
    return (await r.json())[0] || null;
}

function normTags(v) {
    const arr = Array.isArray(v) ? v : String(v || '').split(/[,\s#]+/);
    const out = [];
    for (const t of arr) {
        const s = str(t, LIMITS.tagLen).replace(/^#/, '');
        if (s && !out.includes(s)) out.push(s);
        if (out.length >= LIMITS.tags) break;
    }
    return out;
}

const WRITE_LIMITS_MSG = '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.';

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    const fail = (status, error, message, extra) => json({ ok: false, error, message, ...(extra || {}) }, status);

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // GET: 셀프 진단 (PII 없음) — functions-diagnostics 워크플로가 호출
    if (request.method === 'GET') {
        const out = { 시각: nowIso(), 기본_와펜_세트: { version: SEED_VERSION, count: SEED_ITEMS.length } };   // 새 번들이 배포됐는지 확인용
        try {
            out.환경변수_SUPABASE = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
            if (out.환경변수_SUPABASE) {
                for (const t of ['wappen_users', 'wappen_sessions', 'wappen_projects', 'wappen_items', 'wappen_works', 'wappen_reactions', 'wappen_item_requests', 'wappen_reports']) {
                    const r = await sbFetch(env, `${t}?select=id&limit=1`.replace('wappen_sessions?select=id', 'wappen_sessions?select=token_hash').replace('wappen_reactions?select=id', 'wappen_reactions?select=work_id'));
                    out[`${t}_테이블`] = r.ok;
                    if (!r.ok) out[`${t}_오류`] = await sbDetail(r);
                }
                const rpc = await sbFetch(env, 'rpc/wappen_ranking', { method: 'POST', body: JSON.stringify({ p_period: 'all', p_size_key: null, p_limit: 1 }) });
                out.wappen_ranking_rpc = rpc.ok;
                if (!rpc.ok) out.rpc_오류 = await sbDetail(rpc);
                const bk = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, {
                    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
                out.wappen_버킷 = bk.ok;
                if (bk.ok) { const b = await bk.json().catch(() => ({})); out.버킷_공개 = !!b.public; out.버킷_용량제한 = b.file_size_limit || null; out.버킷_MIME = b.allowed_mime_types || null; }
                else out.버킷_오류 = await sbDetail(bk);
            }
        } catch (e) {
            out.진단_오류 = String(e && e.message || e);
        }
        return json(out);
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    if (!fromOurSite(request)) return fail(403, 'origin', '허용되지 않은 출처입니다.');

    try {
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || '');
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(500, 'env', '서버 설정 오류입니다.');

        // ── 로그인: 카카오 토큰 1회 검증 → 사용자 upsert → 세션 발급 ──────────
        if (action === 'login') {
            if (await rateLimited(env, 'wappen-login', clientIp(request), 30, 3600e3)) return fail(429, 'rate_limited', WRITE_LIMITS_MSG);
            const kk = await verifyKakao(body.kakao_token);
            if (!kk) return fail(401, 'auth', '카카오 로그인이 만료되었습니다. 다시 로그인해주세요.');
            const r0 = await sbFetch(env, `wappen_users?kakao_id=eq.${encodeURIComponent(kk.id)}&select=*&limit=1`);
            if (!r0.ok) return fail(500, 'db', '로그인 처리에 실패했습니다.', { detail: await sbDetail(r0) });
            let user = (await r0.json())[0];
            if (user) {
                // 사용자가 바꾼 닉네임은 유지, 프로필 사진·마지막 로그인만 갱신
                const patch = { last_login_at: nowIso() };
                if (kk.avatar && kk.avatar !== user.avatar_url) patch.avatar_url = kk.avatar;
                const r1 = await sbFetch(env, `wappen_users?id=eq.${user.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
                if (r1.ok) user = (await r1.json())[0] || user;
            } else {
                const nickname = str(kk.nickname, LIMITS.nickname) || '와펜 친구';
                const r1 = await sbFetch(env, 'wappen_users', {
                    method: 'POST', headers: { Prefer: 'return=representation' },
                    body: JSON.stringify({ kakao_id: kk.id, nickname, avatar_url: kk.avatar, is_admin: kk.id === ADMIN_KAKAO_ID, last_login_at: nowIso() }),
                });
                if (!r1.ok) return fail(500, 'db', '회원 등록에 실패했습니다.', { detail: await sbDetail(r1) });
                user = (await r1.json())[0];
            }
            if (user.is_banned) return fail(403, 'banned', '이용이 제한된 계정입니다.');
            const token = newToken();
            const expires_at = new Date(Date.now() + SESSION_DAYS * DAY).toISOString();
            const r2 = await sbFetch(env, 'wappen_sessions', { method: 'POST', body: JSON.stringify({ token_hash: await sha256Hex(token), user_id: user.id, expires_at, last_seen_at: nowIso() }) });
            if (!r2.ok) return fail(500, 'db', '세션 생성에 실패했습니다.', { detail: await sbDetail(r2) });
            // 이 사용자의 만료 세션 정리(결과 무시)
            await sbFetch(env, `wappen_sessions?user_id=eq.${user.id}&expires_at=lt.${nowIso()}`, { method: 'DELETE' }).catch(() => {});
            return json({ ok: true, session: token, expires_at, user: pubUser(user) });
        }

        // ── 이하 액션은 세션 필수 ─────────────────────────────────────────
        const auth = await authSession(env, body.session);
        if (!auth) return fail(401, 'auth', '로그인이 필요합니다. 다시 로그인해주세요.');
        const me = auth.user;
        const READ_ONLY = new Set(['me', 'logout', 'my_reactions', 'my_content', 'my_requests']);
        if (me.is_banned && !READ_ONLY.has(action)) return fail(403, 'banned', '이용이 제한된 계정입니다.');
        const isAdmin = !!me.is_admin;
        const needAdmin = () => isAdmin ? null : fail(403, 'forbidden', '관리자만 사용할 수 있습니다.');

        if (action === 'me') return json({ ok: true, user: pubUser(me) });

        if (action === 'logout') {
            await sbFetch(env, `wappen_sessions?token_hash=eq.${auth.tokenHash}`, { method: 'DELETE' });
            return json({ ok: true });
        }

        if (action === 'me_update') {
            const nickname = str(body.nickname, LIMITS.nickname);
            if (nickname.length < 1) return fail(400, 'bad_nickname', `닉네임은 1~${LIMITS.nickname}자로 입력해주세요.`);
            const r = await sbFetch(env, `wappen_users?id=eq.${me.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ nickname }) });
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            // 표시용 복제 동기화
            await Promise.all([
                sbFetch(env, `wappen_projects?owner_id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({ author_name: nickname }) }),
                sbFetch(env, `wappen_works?author_id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({ author_name: nickname }) }),
            ]).catch(() => {});
            return json({ ok: true, user: pubUser((await r.json())[0] || { ...me, nickname }) });
        }

        // ── 업로드 서명 ─────────────────────────────────────────────────
        if (action === 'upload_sign') {
            const kind = UPLOAD_KINDS[String(body.kind || '')];
            if (!kind) return fail(400, 'bad_kind', '알 수 없는 업로드 종류입니다.');
            if (kind.admin && !isAdmin) return fail(403, 'forbidden', '와펜은 관리자만 등록할 수 있습니다.');
            const ext = String(body.ext || '').toLowerCase().replace('jpeg', 'jpg');
            if (!kind.exts.includes(ext)) return fail(400, 'bad_ext', `허용 형식: ${kind.exts.join(', ')}`);
            if (await rateLimited(env, 'wappen-upload', me.id, 200, DAY)) return fail(429, 'rate_limited', '오늘 업로드 한도를 초과했습니다.');
            const path = `${kind.prefix(me)}${crypto.randomUUID()}.${ext}`;
            const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
                method: 'POST',
                headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!r.ok) return fail(500, 'storage', '업로드 준비에 실패했습니다.', { detail: await sbDetail(r) });
            const data = await r.json().catch(() => ({}));
            let token = data.token;
            try { if (!token && data.url) token = new URL(data.url, env.SUPABASE_URL).searchParams.get('token'); } catch (_) {}
            if (!token) return fail(500, 'storage', '업로드 토큰을 받지 못했습니다.');
            return json({
                ok: true, path, token, content_type: MIME[ext],
                upload_url: `${env.SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(token)}`,
                public_url: publicUrl(env, path),
            });
        }

        // ── 프로젝트 ────────────────────────────────────────────────────
        if (action === 'project_create') {
            const title = str(body.title, LIMITS.title);
            const description = str(body.description, LIMITS.description) || null;
            const size_key = String(body.size_key || '');
            const orientation = String(body.orientation || 'portrait');
            const width_px = intIn(body.width_px, 100, 12000), height_px = intIn(body.height_px, 100, 12000);
            if (!title) return fail(400, 'bad_title', '제목을 입력해주세요.');
            if (!isValidSize(size_key, orientation)) return fail(400, 'bad_size', '사이즈를 선택해주세요.');
            if (!width_px || !height_px) return fail(400, 'bad_dims', '이미지 크기 정보가 없습니다.');
            if (!storageUrlOk(env, body.base_image_url, `base/${me.id}/`)) return fail(400, 'bad_image', '기본 이미지를 먼저 업로드해주세요.');
            if (body.thumb_url && !storageUrlOk(env, body.thumb_url, `thumbs/${me.id}/`)) return fail(400, 'bad_image', '썸네일 URL 이 올바르지 않습니다.');
            const n = await countRows(env, `wappen_projects?owner_id=eq.${me.id}&created_at=gte.${agoIso(DAY)}&select=id`);
            if (n >= LIMITS.perDay.projects) return fail(429, 'rate_limited', `프로젝트는 하루 ${LIMITS.perDay.projects}개까지 만들 수 있습니다.`);
            if (await titleTaken(env, 'wappen_projects', title)) return fail(409, 'dup_title', DUP_PROJECT);
            const row = {
                owner_id: me.id, author_name: me.nickname, author_avatar: me.avatar_url || null,
                title, description, size_key, size_group: presetOf(size_key).group, orientation, width_px, height_px,
                base_image_url: body.base_image_url, thumb_url: body.thumb_url || null,
            };
            const r = await sbFetch(env, 'wappen_projects', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
            if (r.status === 409) return fail(409, 'dup_title', DUP_PROJECT);   // DB 유일 인덱스(동시 요청)
            if (!r.ok) return fail(500, 'db', '프로젝트를 저장하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, project: (await r.json())[0] });
        }

        if (action === 'project_update' || action === 'project_delete') {
            if (!isUuid(body.project_id)) return fail(400, 'bad_id', '프로젝트 id 가 올바르지 않습니다.');
            const p = await getOne(env, 'wappen_projects', body.project_id);
            if (!p) return fail(404, 'not_found', '프로젝트를 찾을 수 없습니다.');
            if (p.owner_id !== me.id && !isAdmin) return fail(403, 'forbidden', '본인 프로젝트만 수정할 수 있습니다.');
            if (action === 'project_delete') {
                const others = await countRows(env, `wappen_works?project_id=eq.${p.id}&author_id=neq.${p.owner_id}&select=id`);
                if (others > 0 && !isAdmin) return fail(409, 'has_works', '다른 사람이 만든 작품이 있어 삭제할 수 없습니다. 대신 숨길 수 있습니다.');
                const r = await sbFetch(env, `wappen_projects?id=eq.${p.id}`, { method: 'DELETE' });
                if (!r.ok) return fail(500, 'db', '삭제하지 못했습니다.', { detail: await sbDetail(r) });
                return json({ ok: true });
            }
            const patch = { updated_at: nowIso() };
            if (body.title != null) {
                const t = str(body.title, LIMITS.title); if (!t) return fail(400, 'bad_title', '제목을 입력해주세요.');
                if (titleKey(t) !== titleKey(p.title) && await titleTaken(env, 'wappen_projects', t, { exclude: p.id })) return fail(409, 'dup_title', DUP_PROJECT);
                patch.title = t;
            }
            if (body.description != null) patch.description = str(body.description, LIMITS.description) || null;
            if (body.status != null) { if (!['active', 'hidden'].includes(body.status)) return fail(400, 'bad_status', '상태 값이 올바르지 않습니다.'); patch.status = body.status; }
            const r = await sbFetch(env, `wappen_projects?id=eq.${p.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
            if (r.status === 409) return fail(409, 'dup_title', DUP_PROJECT);
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, project: (await r.json())[0] });
        }

        // ── 작품 ────────────────────────────────────────────────────────
        if (action === 'work_save') {
            if (!isUuid(body.project_id)) return fail(400, 'bad_id', '프로젝트 id 가 올바르지 않습니다.');
            const project = await getOne(env, 'wappen_projects', body.project_id, 'id,title,status,owner_id');
            if (!project) return fail(404, 'not_found', '프로젝트를 찾을 수 없습니다.');
            if (project.status !== 'active' && project.owner_id !== me.id && !isAdmin) return fail(409, 'project_hidden', '숨겨진 프로젝트입니다.');
            const v = validateLayout(body.layout);
            if (v.error) return fail(400, 'bad_layout', v.error);
            if (v.layout.items.length && !(await itemsExist(env, v.layout.items.map(i => i.id)))) return fail(400, 'bad_layout', '존재하지 않는 와펜이 포함되어 있습니다.');
            if (!storageUrlOk(env, body.preview_url, `previews/${me.id}/`)) return fail(400, 'bad_image', '미리보기 이미지를 먼저 업로드해주세요.');
            if (body.work_id != null && !isUuid(body.work_id)) return fail(400, 'bad_id', '작품 id 가 올바르지 않습니다.');
            const editId = body.work_id != null ? String(body.work_id).toLowerCase() : null;
            let w = null;
            if (editId) {
                w = await getOne(env, 'wappen_works', editId, 'id,author_id,project_id');
                if (!w) return fail(404, 'not_found', '작품을 찾을 수 없습니다.');
                if (w.author_id !== me.id && !isAdmin) return fail(403, 'forbidden', '본인 작품만 수정할 수 있습니다.');
                if (w.project_id !== project.id) return fail(400, 'bad_project', '작품의 프로젝트가 일치하지 않습니다.');
            }
            // 같은 프로젝트 안에서 작품 이름 중복 방지: 직접 정한 제목이 겹치면 거절, 비워 보낸 기본 제목(프로젝트명)은 "이름 (2)" 식으로 번호를 붙인다
            const titleScope = { extra: `&project_id=eq.${project.id}`, exclude: editId };
            let title = str(body.title, LIMITS.title);
            if (title) { if (await titleTaken(env, 'wappen_works', title, titleScope)) return fail(409, 'dup_title', DUP_WORK); }
            else title = await uniqueTitle(env, 'wappen_works', str(project.title, LIMITS.title) || '내 작품', titleScope);
            const preview_w = intIn(body.preview_w, 1, 12000), preview_h = intIn(body.preview_h, 1, 12000);
            const common = { title, layout: v.layout, preview_url: body.preview_url, preview_w, preview_h, updated_at: nowIso() };

            if (w) {
                const r = await sbFetch(env, `wappen_works?id=eq.${w.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(common) });
                if (r.status === 409) return fail(409, 'dup_title', DUP_WORK);
                if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
                return json({ ok: true, work: (await r.json())[0] });
            }
            let remix_of = null;
            if (body.remix_of) {
                if (!isUuid(body.remix_of)) return fail(400, 'bad_id', '원작 id 가 올바르지 않습니다.');
                const src = await getOne(env, 'wappen_works', body.remix_of, 'id,project_id,status');
                if (!src || src.project_id !== project.id) return fail(400, 'bad_remix', '원작 작품을 찾을 수 없습니다.');
                remix_of = src.id;
            }
            const n = await countRows(env, `wappen_works?author_id=eq.${me.id}&created_at=gte.${agoIso(DAY)}&select=id`);
            if (n >= LIMITS.perDay.works) return fail(429, 'rate_limited', `작품은 하루 ${LIMITS.perDay.works}개까지 저장할 수 있습니다.`);
            const row = { ...common, project_id: project.id, author_id: me.id, author_name: me.nickname, author_avatar: me.avatar_url || null, remix_of };
            const r = await sbFetch(env, 'wappen_works', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
            if (!r.ok) return fail(500, 'db', '작품을 저장하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, work: (await r.json())[0] });
        }

        if (action === 'work_delete') {
            if (!isUuid(body.work_id)) return fail(400, 'bad_id', '작품 id 가 올바르지 않습니다.');
            const w = await getOne(env, 'wappen_works', body.work_id, 'id,author_id');
            if (!w) return fail(404, 'not_found', '작품을 찾을 수 없습니다.');
            if (w.author_id !== me.id && !isAdmin) return fail(403, 'forbidden', '본인 작품만 삭제할 수 있습니다.');
            const r = await sbFetch(env, `wappen_works?id=eq.${w.id}`, { method: 'DELETE' });
            if (!r.ok) return fail(500, 'db', '삭제하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true });
        }

        // ── 반응 ────────────────────────────────────────────────────────
        if (action === 'react') {
            if (!isUuid(body.work_id)) return fail(400, 'bad_id', '작품 id 가 올바르지 않습니다.');
            const kind = body.kind == null || body.kind === '' ? null : String(body.kind);
            if (kind !== null && !REACTION_KEYS.includes(kind)) return fail(400, 'bad_kind', '알 수 없는 반응입니다.');
            const w = await getOne(env, 'wappen_works', body.work_id, 'id,status');
            if (!w || w.status !== 'active') return fail(404, 'not_found', '작품을 찾을 수 없습니다.');
            if (await rateLimited(env, 'wappen-react', me.id, 600, DAY)) return fail(429, 'rate_limited', WRITE_LIMITS_MSG);
            let r;
            if (kind === null) {
                r = await sbFetch(env, `wappen_reactions?work_id=eq.${w.id}&user_id=eq.${me.id}`, { method: 'DELETE' });
            } else {
                r = await sbFetch(env, 'wappen_reactions?on_conflict=work_id,user_id', {
                    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
                    body: JSON.stringify({ work_id: w.id, user_id: me.id, kind }),
                });
            }
            if (!r.ok) return fail(500, 'db', '반응을 저장하지 못했습니다.', { detail: await sbDetail(r) });
            const after = await getOne(env, 'wappen_works', w.id, 'reaction_count,reaction_counts');
            return json({ ok: true, mine: kind, reaction_count: after ? after.reaction_count : 0, reaction_counts: after ? after.reaction_counts : {} });
        }

        if (action === 'my_reactions') {
            const ids = (Array.isArray(body.work_ids) ? body.work_ids : []).filter(isUuid).slice(0, 100);
            if (!ids.length) return json({ ok: true, reactions: {} });
            const r = await sbFetch(env, `wappen_reactions?user_id=eq.${me.id}&work_id=in.(${ids.join(',')})&select=work_id,kind`);
            if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
            const reactions = {};
            for (const row of await r.json()) reactions[row.work_id] = row.kind;
            return json({ ok: true, reactions });
        }

        // ── 내 콘텐츠(숨김 포함) ─────────────────────────────────────────
        if (action === 'my_content') {
            const [p, w, q] = await Promise.all([
                sbFetch(env, `wappen_projects?owner_id=eq.${me.id}&select=*&order=created_at.desc&limit=200`),
                sbFetch(env, `wappen_works?author_id=eq.${me.id}&select=*,wappen_projects(id,title,size_key,orientation,status)&order=created_at.desc&limit=200`),
                sbFetch(env, `wappen_item_requests?user_id=eq.${me.id}&select=*,wappen_items(id,name,image_url)&order=created_at.desc&limit=100`),
            ]);
            if (!p.ok || !w.ok || !q.ok) return fail(500, 'db', '불러오지 못했습니다.');
            return json({ ok: true, projects: await p.json(), works: await w.json(), requests: await q.json() });
        }

        if (action === 'my_requests') {
            const r = await sbFetch(env, `wappen_item_requests?user_id=eq.${me.id}&select=*,wappen_items(id,name,image_url)&order=created_at.desc&limit=100`);
            if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, requests: await r.json() });
        }

        // ── 신고 ────────────────────────────────────────────────────────
        if (action === 'report') {
            const target_type = String(body.target_type || '');
            if (!['work', 'project'].includes(target_type) || !isUuid(body.target_id)) return fail(400, 'bad_target', '신고 대상이 올바르지 않습니다.');
            if (!REPORT_REASON_KEYS.includes(String(body.reason))) return fail(400, 'bad_reason', '신고 사유를 선택해주세요.');
            const target = await getOne(env, target_type === 'work' ? 'wappen_works' : 'wappen_projects', body.target_id, 'id');
            if (!target) return fail(404, 'not_found', '신고 대상을 찾을 수 없습니다.');
            const n = await countRows(env, `wappen_reports?reporter_id=eq.${me.id}&created_at=gte.${agoIso(DAY)}&select=id`);
            if (n >= LIMITS.perDay.reports) return fail(429, 'rate_limited', `신고는 하루 ${LIMITS.perDay.reports}건까지 가능합니다.`);
            const r = await sbFetch(env, 'wappen_reports', { method: 'POST', body: JSON.stringify({
                reporter_id: me.id, target_type, target_id: body.target_id, reason: body.reason, detail: str(body.detail, LIMITS.reportDetail) || null }) });
            if (r.status === 409) return fail(409, 'duplicate', '이미 신고한 대상입니다.');
            if (!r.ok) return fail(500, 'db', '신고를 접수하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true });
        }

        // ── 와펜 추가 요청 ──────────────────────────────────────────────
        if (action === 'request_create') {
            const name = str(body.name, LIMITS.itemName);
            if (!name) return fail(400, 'bad_name', '요청할 와펜 이름을 입력해주세요.');
            if (body.ref_image_url && !storageUrlOk(env, body.ref_image_url, `requests/${me.id}/`)) return fail(400, 'bad_image', '참고 이미지 URL 이 올바르지 않습니다.');
            const n = await countRows(env, `wappen_item_requests?user_id=eq.${me.id}&created_at=gte.${agoIso(DAY)}&select=id`);
            if (n >= LIMITS.perDay.requests) return fail(429, 'rate_limited', `요청은 하루 ${LIMITS.perDay.requests}건까지 가능합니다.`);
            const r = await sbFetch(env, 'wappen_item_requests', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
                user_id: me.id, name, description: str(body.description, LIMITS.requestDesc) || null, ref_image_url: body.ref_image_url || null }) });
            if (!r.ok) return fail(500, 'db', '요청을 저장하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, request: (await r.json())[0] });
        }

        // ── 관리자 ──────────────────────────────────────────────────────
        if (action.startsWith('admin_')) {
            const denied = needAdmin();
            if (denied) return denied;
        }

        if (action === 'admin_overview') {
            const [pending, open, users, items] = await Promise.all([
                countRows(env, 'wappen_item_requests?status=eq.pending&select=id'),
                countRows(env, 'wappen_reports?status=eq.open&select=id'),
                countRows(env, 'wappen_users?select=id'),
                countRows(env, 'wappen_items?status=eq.active&select=id'),
            ]);
            return json({ ok: true, pending_requests: pending, open_reports: open, users, items });
        }

        if (action === 'admin_seed_status') {
            const r = await sbFetch(env, 'wappen_items?select=image_url&limit=5000');
            if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
            const have = new Set((await r.json()).map(x => x.image_url));
            const missing = SEED_ITEMS.filter(it => !have.has(SEED_BASE + it.file)).length;
            return json({ ok: true, version: SEED_VERSION, total: SEED_ITEMS.length, installed: SEED_ITEMS.length - missing, missing });
        }

        if (action === 'admin_seed_items') {
            const r0 = await sbFetch(env, 'wappen_items?select=image_url&limit=5000');
            if (!r0.ok) return fail(500, 'db', '기존 와펜을 확인하지 못했습니다.', { detail: await sbDetail(r0) });
            const have = new Set((await r0.json()).map(x => x.image_url));
            const rows = SEED_ITEMS.map((it, i) => ({ it, i })).filter(({ it }) => !have.has(SEED_BASE + it.file)).map(({ it, i }) => ({
                name: it.name, category: it.category, tags: it.tags, image_url: SEED_BASE + it.file,
                width_px: it.w, height_px: it.h, sort_order: i, created_by: me.id,
            }));
            if (!rows.length) return json({ ok: true, added: 0, skipped: SEED_ITEMS.length, total: SEED_ITEMS.length });
            const r = await sbFetch(env, 'wappen_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
            if (!r.ok) return fail(500, 'db', '기본 와펜을 등록하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, added: rows.length, skipped: SEED_ITEMS.length - rows.length, total: SEED_ITEMS.length });
        }

        if (action === 'admin_items') {
            const r = await sbFetch(env, 'wappen_items?select=*&order=category.asc,sort_order.asc,created_at.desc&limit=1000');
            if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, items: await r.json() });
        }

        if (action === 'admin_item_create') {
            const name = str(body.name, LIMITS.itemName), category = str(body.category, LIMITS.category) || '기본';
            if (!name) return fail(400, 'bad_name', '와펜 이름을 입력해주세요.');
            if (!storageUrlOk(env, body.image_url, 'items/')) return fail(400, 'bad_image', '와펜 PNG 를 먼저 업로드해주세요.');
            const width_px = intIn(body.width_px, 8, 4000), height_px = intIn(body.height_px, 8, 4000);
            if (!width_px || !height_px) return fail(400, 'bad_dims', '이미지 크기 정보가 없습니다.');
            const row = { name, category, tags: normTags(body.tags), image_url: body.image_url, width_px, height_px,
                sort_order: intIn(body.sort_order, -100000, 100000) ?? 0, created_by: me.id };
            const r = await sbFetch(env, 'wappen_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
            if (!r.ok) return fail(500, 'db', '와펜을 저장하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, item: (await r.json())[0] });
        }

        if (action === 'admin_item_update') {
            if (!isUuid(body.item_id)) return fail(400, 'bad_id', '와펜 id 가 올바르지 않습니다.');
            const patch = {};
            if (body.name != null) { const t = str(body.name, LIMITS.itemName); if (!t) return fail(400, 'bad_name', '와펜 이름을 입력해주세요.'); patch.name = t; }
            if (body.category != null) patch.category = str(body.category, LIMITS.category) || '기본';
            if (body.tags != null) patch.tags = normTags(body.tags);
            if (body.sort_order != null) patch.sort_order = intIn(body.sort_order, -100000, 100000) ?? 0;
            if (body.status != null) { if (!['active', 'hidden'].includes(body.status)) return fail(400, 'bad_status', '상태 값이 올바르지 않습니다.'); patch.status = body.status; }
            const r = await sbFetch(env, `wappen_items?id=eq.${body.item_id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            const rows = await r.json();
            if (!rows.length) return fail(404, 'not_found', '와펜을 찾을 수 없습니다.');
            return json({ ok: true, item: rows[0] });
        }

        if (action === 'admin_item_delete') {
            if (!isUuid(body.item_id)) return fail(400, 'bad_id', '와펜 id 가 올바르지 않습니다.');
            // 작품이 참조하면 숨김으로 대체 (layout jsonb 포함 검색)
            const used = await countRows(env, `wappen_works?layout=cs.${encodeURIComponent(JSON.stringify({ items: [{ id: body.item_id }] }))}&select=id`);
            if (used > 0) {
                const r = await sbFetch(env, `wappen_items?id=eq.${body.item_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) });
                if (!r.ok) return fail(500, 'db', '처리하지 못했습니다.', { detail: await sbDetail(r) });
                return json({ ok: true, hidden: true, used });
            }
            const r = await sbFetch(env, `wappen_items?id=eq.${body.item_id}`, { method: 'DELETE' });
            if (!r.ok) return fail(500, 'db', '삭제하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, hidden: false });
        }

        // 여러 와펜 한 번에 — 선택한 id 목록 또는 분류 전체. 작품에 쓰인 것은 숨김, 나머지는 삭제 (단건 admin_item_delete 와 같은 규칙)
        if (action === 'admin_items_delete') {
            let ids;
            const category = body.category != null ? str(body.category, LIMITS.category) : '';
            if (category) {
                const r = await sbFetch(env, `wappen_items?category=eq.${encodeURIComponent(category)}&select=id&limit=1000`);
                if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
                ids = (await r.json()).map(x => x.id);
            } else {
                ids = Array.isArray(body.item_ids) ? [...new Set(body.item_ids.map(x => String(x || '').toLowerCase()))] : [];
                if (!ids.length || ids.length > 500 || !ids.every(isUuid)) return fail(400, 'bad_ids', '삭제할 와펜을 선택해주세요. (한 번에 500개까지)');
            }
            if (!ids.length) return json({ ok: true, deleted: 0, hidden: 0, used_ids: [] });
            const used = await usedItemIds(env, ids);
            const toHide = ids.filter(id => used.has(id)), toDel = ids.filter(id => !used.has(id));
            for (let i = 0; i < toHide.length; i += 50) {
                const r = await sbFetch(env, `wappen_items?id=in.(${toHide.slice(i, i + 50).join(',')})`, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) });
                if (!r.ok) return fail(500, 'db', '처리하지 못했습니다.', { detail: await sbDetail(r) });
            }
            for (let i = 0; i < toDel.length; i += 50) {
                const r = await sbFetch(env, `wappen_items?id=in.(${toDel.slice(i, i + 50).join(',')})`, { method: 'DELETE' });
                if (!r.ok) return fail(500, 'db', '삭제하지 못했습니다.', { detail: await sbDetail(r) });
            }
            return json({ ok: true, deleted: toDel.length, hidden: toHide.length, used_ids: toHide });
        }

        if (action === 'admin_requests') {
            const status = ['pending', 'approved', 'rejected'].includes(body.status) ? `&status=eq.${body.status}` : '';
            const sel = '*,requester:wappen_users!wappen_item_requests_user_id_fkey(nickname,avatar_url),wappen_items(id,name,image_url)';
            const r = await sbFetch(env, `wappen_item_requests?select=${encodeURIComponent(sel)}${status}&order=created_at.desc&limit=300`);
            if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, requests: await r.json() });
        }

        if (action === 'admin_request_resolve') {
            if (!isUuid(body.request_id)) return fail(400, 'bad_id', '요청 id 가 올바르지 않습니다.');
            if (!['approved', 'rejected', 'pending'].includes(body.status)) return fail(400, 'bad_status', '상태 값이 올바르지 않습니다.');
            if (body.item_id != null && body.item_id !== '' && !isUuid(body.item_id)) return fail(400, 'bad_id', '와펜 id 가 올바르지 않습니다.');
            const patch = { status: body.status, admin_note: str(body.admin_note, 300) || null,
                item_id: body.item_id || null, resolved_by: body.status === 'pending' ? null : me.id, resolved_at: body.status === 'pending' ? null : nowIso() };
            const r = await sbFetch(env, `wappen_item_requests?id=eq.${body.request_id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            const rows = await r.json();
            if (!rows.length) return fail(404, 'not_found', '요청을 찾을 수 없습니다.');
            return json({ ok: true, request: rows[0] });
        }

        if (action === 'admin_reports') {
            const status = ['open', 'resolved', 'dismissed'].includes(body.status) ? `&status=eq.${body.status}` : '';
            const sel = '*,reporter:wappen_users!wappen_reports_reporter_id_fkey(nickname)';
            const r = await sbFetch(env, `wappen_reports?select=${encodeURIComponent(sel)}${status}&order=created_at.desc&limit=300`);
            if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
            const reports = await r.json();
            // 대상 요약 붙이기 (작품/프로젝트 각 1회 조회)
            const wIds = [...new Set(reports.filter(x => x.target_type === 'work').map(x => x.target_id))].slice(0, 200);
            const pIds = [...new Set(reports.filter(x => x.target_type === 'project').map(x => x.target_id))].slice(0, 200);
            const targets = {};
            if (wIds.length) {
                const rw = await sbFetch(env, `wappen_works?id=in.(${wIds.join(',')})&select=id,title,preview_url,status,author_name,author_id,project_id`);
                if (rw.ok) for (const w of await rw.json()) targets['work:' + w.id] = { ...w, image: w.preview_url };
            }
            if (pIds.length) {
                const rp = await sbFetch(env, `wappen_projects?id=in.(${pIds.join(',')})&select=id,title,thumb_url,base_image_url,status,author_name,owner_id`);
                if (rp.ok) for (const p of await rp.json()) targets['project:' + p.id] = { ...p, image: p.thumb_url || p.base_image_url, author_id: p.owner_id };
            }
            for (const rep of reports) rep.target = targets[rep.target_type + ':' + rep.target_id] || null;
            return json({ ok: true, reports });
        }

        if (action === 'admin_report_resolve') {
            if (!isUuid(body.report_id)) return fail(400, 'bad_id', '신고 id 가 올바르지 않습니다.');
            if (!['resolved', 'dismissed', 'open'].includes(body.status)) return fail(400, 'bad_status', '상태 값이 올바르지 않습니다.');
            const patch = { status: body.status, resolved_by: body.status === 'open' ? null : me.id, resolved_at: body.status === 'open' ? null : nowIso() };
            const r = await sbFetch(env, `wappen_reports?id=eq.${body.report_id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            const rows = await r.json();
            if (!rows.length) return fail(404, 'not_found', '신고를 찾을 수 없습니다.');
            return json({ ok: true, report: rows[0] });
        }

        if (action === 'admin_set_hidden') {
            const table = { work: 'wappen_works', project: 'wappen_projects', item: 'wappen_items' }[String(body.target_type || '')];
            if (!table || !isUuid(body.target_id)) return fail(400, 'bad_target', '대상이 올바르지 않습니다.');
            const r = await sbFetch(env, `${table}?id=eq.${body.target_id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: body.hidden ? 'hidden' : 'active' }) });
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            const rows = await r.json();
            if (!rows.length) return fail(404, 'not_found', '대상을 찾을 수 없습니다.');
            return json({ ok: true, status: rows[0].status });
        }

        if (action === 'admin_users') {
            const q = str(body.q, 40);
            const filter = q ? (/^\d{5,}$/.test(q) ? `&kakao_id=eq.${q}` : `&nickname=ilike.*${encodeURIComponent(q.replace(/[%*,()]/g, ''))}*`) : '';
            const r = await sbFetch(env, `wappen_users?select=id,nickname,avatar_url,is_admin,is_banned,banned_reason,created_at,last_login_at${filter}&order=last_login_at.desc.nullslast&limit=50`);
            if (!r.ok) return fail(500, 'db', '불러오지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, users: await r.json() });
        }

        if (action === 'admin_ban_user') {
            if (!isUuid(body.user_id)) return fail(400, 'bad_id', '사용자 id 가 올바르지 않습니다.');
            if (body.user_id === me.id) return fail(400, 'self', '자기 자신은 차단할 수 없습니다.');
            const target = await getOne(env, 'wappen_users', body.user_id, 'id,kakao_id,is_admin');
            if (!target) return fail(404, 'not_found', '사용자를 찾을 수 없습니다.');
            if (target.kakao_id === ADMIN_KAKAO_ID) return fail(403, 'forbidden', '운영 관리자는 차단할 수 없습니다.');
            const banned = !!body.banned;
            const r = await sbFetch(env, `wappen_users?id=eq.${target.id}`, { method: 'PATCH', body: JSON.stringify({ is_banned: banned, banned_reason: banned ? (str(body.reason, 200) || null) : null }) });
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            if (banned) {
                // 세션 끊고 콘텐츠 숨김(해제 시 자동 복구하지 않음 — 관리자가 개별 확인)
                await Promise.all([
                    sbFetch(env, `wappen_sessions?user_id=eq.${target.id}`, { method: 'DELETE' }),
                    sbFetch(env, `wappen_works?author_id=eq.${target.id}&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }),
                    sbFetch(env, `wappen_projects?owner_id=eq.${target.id}&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }),
                ]).catch(() => {});
            }
            return json({ ok: true, banned });
        }

        if (action === 'admin_set_admin') {
            if (!isUuid(body.user_id)) return fail(400, 'bad_id', '사용자 id 가 올바르지 않습니다.');
            const target = await getOne(env, 'wappen_users', body.user_id, 'id,kakao_id');
            if (!target) return fail(404, 'not_found', '사용자를 찾을 수 없습니다.');
            const on = !!body.is_admin;
            if (!on && (target.kakao_id === ADMIN_KAKAO_ID || target.id === me.id)) return fail(403, 'forbidden', '운영 관리자·본인의 관리자 권한은 해제할 수 없습니다.');
            const r = await sbFetch(env, `wappen_users?id=eq.${target.id}`, { method: 'PATCH', body: JSON.stringify({ is_admin: on }) });
            if (!r.ok) return fail(500, 'db', '저장하지 못했습니다.', { detail: await sbDetail(r) });
            return json({ ok: true, is_admin: on });
        }

        return fail(400, 'unknown_action', '알 수 없는 요청입니다.');
    } catch (e) {
        return json({ ok: false, error: 'internal', message: '서버 오류가 발생했습니다.', detail: String(e && e.message || e).slice(0, 300) }, 500);
    }
}
