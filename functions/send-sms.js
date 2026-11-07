// Cloudflare Pages Function: /send-sms
// 공간 대관 접수 직후, 신청자 연락처로 접수 확인 문자를 1회 발송한다 (솔라피 API).
// + 고정 합주팀 문자(2026-11-07): 가입 접수 확인 {band_signup_id}(공개, 신청 15분 안·1회) /
//   승인·거절 안내 {band_profile_id, kind:'approve'|'reject', sb_token[, resend]}(게더링 운영 계정 세션만) /
//   운영자 테스트 {band_test:'signup'|'approve'|'reject', sb_token}(본인 번호로 [테스트] 문구, 기록 없음).
//   1회 보장은 band_sms_log(profile_id, kind) PK 선점(마이그레이션 20261107_band_sms_log.sql) — resend 는 upsert 로 다시 보낸다.
// 공개 페이지(비로그인)에서 호출되므로 요청을 그대로 믿지 않는다:
//   1) 서비스 롤 키로 performance_bookings에서 해당 예약 건을 직접 조회해 대조
//   2) 접수 15분 이내 건만 발송 (오래된 건 재호출은 거부)
//   3) 발송 전 sms_sent_at을 조건부 PATCH로 선점 — 같은 건은 평생 1회만 발송
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (기존 /notify-admins와 공유),
//      SOLAPI_API_KEY, SOLAPI_API_SECRET, SMS_SENDER (미설정이면 발송 기능 꺼짐)
// 사전 준비(1회, Supabase SQL Editor):
//   alter table performance_bookings add column if not exists sms_sent_at timestamptz;

function corsFor(origin) {
    const host = (() => { try { return new URL(origin).hostname; } catch { return ''; } })();
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

const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// 솔라피 인증: Authorization: HMAC-SHA256 apiKey=…, date=…, salt=…, signature=…
// signature = HMAC-SHA256(apiSecret, date + salt) hex
async function solapiAuthHeader(apiKey, apiSecret) {
    const date = new Date().toISOString();
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(apiSecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt)));
    return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 접수 직후 발송되는 예약 확인·입금 안내 문자.
// 90byte 초과라 솔라피가 장문(LMS)으로 자동 전환해 발송한다(한도 2,000byte).
// 이모지는 문자 인코딩(EUC-KR)에서 깨질 수 있어 넣지 않는다.
// 요금 규칙은 index.html calcPerformanceFee와 동일하게 유지할 것:
//   주말(토·일) 40,000/시간, 평일 25,000/시간 + 5인 초과 시 예약당 1인 5,000원
function buildText(bk) {
    const [, m, d] = bk.date.split('-').map(Number);
    const dow = new Date(bk.date + 'T00:00:00Z').getUTCDay();
    const wd = ['일', '월', '화', '수', '목', '금', '토'][dow];
    const sh = parseInt(bk.start_time, 10);
    const eh = parseInt(bk.end_time, 10) + 1; // end_time은 마지막 이용 슬롯의 시작(22:00 = 실제 종료 23:00)
    const hours = eh - sh;
    const fee = hours * (dow === 0 || dow === 6 ? 40000 : 25000)
        + (bk.headcount > 5 ? (bk.headcount - 5) * 5000 : 0);
    // 예약번호는 booking_code 마이그레이션(20260829) 전 접수 건엔 없을 수 있어 조건부
    const codeLine = bk.booking_code ? `예약번호: ${bk.booking_code}\n\n` : '';
    return `안녕하세요 ! 신촌 프리미엄 밴드 스튜디오 게더 올 어라운드(Gather all around)입니다.

[ ${m}/${d}(${wd}) ${sh}-${eh}시(${hours}시간) ${bk.headcount}명 ] 예약이 확인되었습니다.

${codeLine}이용요금(${fee.toLocaleString('ko-KR')}원)을 아래 계좌로 입금해주시면 예약이 확정됩니다!

토스뱅크 1000-2274-7678 최경수

※ 신청 후 4시간 안에 입금 확인이 되지 않으면 예약이 자동 취소됩니다.
※ 예약 상태는 홈페이지 [공간 대관 > 예약 조회]에서 예약번호와 연락처로 확인하실 수 있습니다.
※ 기준 인원 수(5명)를 초과하는 인원에 대해 변동이 있을시 추가 1명당 5천원이 지불됩니다. 변동시 이용 전날까지 말씀주시면 감사하겠습니다.`;
}

// ── 고정 합주팀 문자 본문 ──────────────────────────────────────────────
// index.html bandCycleSummaryHTML(등록 회차)·send-reminders.js bandRentText 와 같은 규칙:
//   보증금(1개월분) 입금으로 등록 확정 · 등록 회차 이용료는 시작일 전날까지 · 다음 회차부터 입금일 = 사용 3주차(문자 자동 안내)
//   캐비넷 = 회차당 2만원 추가 · 가입 때 정한 숫자 4자리가 캐비넷 비밀번호. 이모지 없음(EUC-KR), LMS 한도 2,000byte 안.
const GATHEO_ADMIN_BAND_ID = 'wearegatheo';
const BAND_BANK_LINE = '토스뱅크 1000-2274-7678 최경수'; // send-reminders.js · index.html 과 동일 문자열 유지
const BAND_CONTACT = '010-5109-1042';                     // index.html PORTAL_PHONE
const BAND_SITE = 'gatherallaround.com/band';
const BAND_DOW = ['일', '월', '화', '수', '목', '금', '토'];
const BAND_GREETING = '안녕하세요! 신촌 프리미엄 밴드 스튜디오 게더 올 어라운드(Gather all around)입니다.';
const ymdAdd = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const mdOf = (ymd) => { const [, m, d] = String(ymd).split('-').map(Number); return `${m}/${d}`; };
const wdOf = (ymd) => BAND_DOW[new Date(ymd + 'T00:00:00Z').getUTCDay()];
const mdw = (ymd) => `${mdOf(ymd)}(${wdOf(ymd)})`;
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const hourOf = (t) => parseInt(String(t || '').slice(0, 2), 10);
// 타임 표기: band_slot_claims(end_time exclusive) → "금요일 18~23시"; 신청 행이 없으면 종전 timeslots('금_야간') → "금요일 야간"
export function bandSlotText(claims, timeslots) {
    const rows = (claims || []).filter(c => c && Number.isInteger(c.day_of_week)).sort((a, b) => a.day_of_week - b.day_of_week || String(a.start_time).localeCompare(String(b.start_time)));
    if (rows.length) return rows.map(c => `${BAND_DOW[c.day_of_week]}요일 ${hourOf(c.start_time)}~${hourOf(c.end_time)}시`).join(', ');
    const keys = Array.isArray(timeslots) ? timeslots : [];
    return keys.map(k => { const [d, l] = String(k).split('_'); return l ? `${d}요일 ${l}` : String(k); }).join(', ');
}
const teamNameOf = (p) => p.band_name_kr || p.name || '';
const monthsOf = (p) => String(p.band_expected_months || '').trim();
// 캐비넷(2026-11-07): 6개월 이상 사용 팀 무료 · 미만 회차당 2만원 — index.html bandCabinetLabel · send-reminders.js 와 같은 규칙. band_cabinet true/false/null(미응답)
const monthsStrict = (txt) => { const m = parseInt((String(txt || '').match(/(\d+)\s*개월/) || [])[1], 10); return m > 0 ? m : null; };
const cabinetFree = (months) => months != null && months >= 6;
export function bandCabinetLine(p) {
    if (p.band_cabinet === true) { const m = monthsStrict(p.band_expected_months); return m == null ? '사용함 (6개월 이상 무료, 미만 회차당 2만원)' : cabinetFree(m) ? '사용함 (6개월 이상 무료)' : '사용함 (회차당 2만원, 이용료와 함께 입금)'; }
    if (p.band_cabinet === false) return '사용 안 함';
    return '';
}
function cabinetBlock(p) {
    const m = monthsStrict(p.band_expected_months);
    if (p.band_cabinet === true) {
        return cabinetFree(m)
            ? `[캐비넷 이용 안내]
- 신청하신 캐비넷은 6개월 이상 사용 팀 무료로 제공됩니다.
- 가입 때 정한 숫자 4자리가 캐비넷 비밀번호로 등록됩니다.`
            : `[캐비넷 이용 안내]
- 신청하신 캐비넷은 회차당 2만원이며, 이용료와 함께 입금해주시면 됩니다(6개월 이상 사용 시 무료).
- 가입 때 정한 숫자 4자리가 캐비넷 비밀번호로 등록됩니다.`;
    }
    return `[캐비넷 이용 안내]
- 캐비넷은 6개월 이상 사용 팀 무료, 그 미만은 회차당 2만원(이용료와 함께 입금)입니다.
- 이용을 원하시면 로그인 후 [요청사항] 또는 문자(${BAND_CONTACT})로 알려주세요. 가입 때 정한 숫자 4자리가 캐비넷 비밀번호로 등록됩니다.`;
}
export function bandSignupText(p, claims) {
    const slot = bandSlotText(claims, p.timeslots);
    const startLine = p.band_start_date ? `\n- 희망 시작일: ${mdw(p.band_start_date)}부터${monthsOf(p) ? ` · 예상 ${monthsOf(p)}` : ''}` : '';
    const idLine = p.instruments ? `\n- 로그인 아이디: ${p.instruments} (밴드 영문명)` : '';
    const cabLine = bandCabinetLine(p) ? `\n- 캐비넷: ${bandCabinetLine(p)}` : '';
    return `${BAND_GREETING}

[${teamNameOf(p)}] 팀의 고정 합주팀 가입 신청이 접수되었습니다.

- 신청 타임: ${slot || '미정'}${startLine}${cabLine}${idLine}

운영팀이 일정을 확인한 뒤 승인 여부를 문자로 안내드립니다. 승인되면 보증금 입금 안내를 함께 보내드립니다.
승인 전에는 로그인하셔도 대기 화면만 보입니다.

※ 신청 내용 변경·문의: ${BAND_CONTACT}`;
}
export function bandApproveText(p, claims) {
    const slot = bandSlotText(claims, p.timeslots);
    const start = p.band_start_date;
    const deposit = Number(p.band_deposit) > 0 ? `보증금(1개월분, ${won(p.band_deposit)})` : '보증금(1개월분)';
    const fee = Number(p.band_fee) > 0 ? `고정 사용 이용료(${won(p.band_fee)})` : '고정 사용 이용료';
    const eve = start ? `시작일 전날(${mdOf(ymdAdd(start, -1))})까지` : '시작일 전날까지';
    return `${BAND_GREETING}

[${teamNameOf(p)}] 팀의 고정 합주팀 가입이 승인되었습니다. 환영합니다!

- 고정 시간: ${slot ? '매주 ' + slot : '운영팀과 협의'}
- 시작일: ${start ? mdw(start) + '부터 4주 단위' : '추후 안내'}
- 로그인: ${BAND_SITE} · 아이디 ${p.instruments || '(밴드 영문명)'} · 비밀번호 pw+숫자 4자리

${deposit}을 아래 계좌로 입금해주시면 등록이 확정됩니다.
${fee}는 ${eve} 입금해주세요.

${BAND_BANK_LINE}

${cabinetBlock(p)}

※ 다음 회차부터는 사용 3주차에 입금 안내 문자를 보내드립니다.
※ 건너뛰기권·대체 합주 등 이용 규칙은 로그인 후 [합주 시간·건너뛰기권]에서 확인하실 수 있습니다.
※ 보증금은 사용 종료 시 반환됩니다.`;
}
export function bandRejectText(p) {
    return `안녕하세요! 게더 올 어라운드(Gather all around)입니다.

[${teamNameOf(p)}] 팀의 고정 합주팀 가입 신청은 아쉽게도 이번에는 진행이 어렵게 되었습니다. 신청하신 타임에 자리가 나면 다시 안내드리겠습니다.

※ 문의: ${BAND_CONTACT}`;
}
const BAND_TEXT = { signup: bandSignupText, approve: bandApproveText, reject: bandRejectText };
const BAND_SUBJECT = { signup: '게더 올 어라운드 가입 접수', approve: '게더 올 어라운드 가입 승인', reject: '게더 올 어라운드 가입 안내' };
const BAND_SAMPLE = { band_name_kr: '게더링', band_name_en: 'GatheO', instruments: 'gatheo', band_start_date: null, band_expected_months: '6개월', band_fee: 250000, band_deposit: 250000, timeslots: ['금_야간'], band_cabinet: true };
const isAdminBand = (t) => {
    const loginId = String(t.instruments || '').trim().toLowerCase();
    const emailId = String(t.email || '').trim().toLowerCase().split('@')[0];
    return loginId === GATHEO_ADMIN_BAND_ID || emailId === GATHEO_ADMIN_BAND_ID;
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Supabase 세션 토큰 → 사용자 id (send-reminders.js 와 동일)
async function verifySb(env, jwt) {
    if (!jwt || typeof jwt !== 'string' || jwt.length > 4096) return null;
    try {
        const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + jwt } });
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        return u && u.id ? String(u.id) : null;
    } catch (_) { return null; }
}
async function solapiSend(env, to, text, subject) {
    return fetch('https://api.solapi.com/messages/v4/send', {
        method: 'POST',
        headers: { Authorization: await solapiAuthHeader(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { to, from: String(env.SMS_SENDER).replace(/\D/g, ''), text, subject } }),
    });
}
const PROFILE_SEL = 'id,name,band_name_kr,band_name_en,instruments,email,member_type,status,leader_phone,phone,timeslots,band_start_date,band_expected_months,band_fee,band_deposit,created_at,band_cabinet';
const PROFILE_SEL_NO_CABINET = PROFILE_SEL.replace(',band_cabinet', ''); // 마이그레이션(20261107_band_cabinet) 전 폴백
// 고정 합주팀 문자 분기. 응답은 json(obj, status).
async function handleBandSms(body, env, json) {
    const SUPABASE_URL = env.SUPABASE_URL, SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'missing SUPABASE env vars' }, 500);
    const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const smsOn = !!(env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SMS_SENDER);
    const getProfile = async (id) => {
        let r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=${PROFILE_SEL}&limit=1`, { headers: sbHeaders });
        if (r.status === 400) { // band_cabinet 컬럼이 아직 없으면 그 컬럼 없이 다시 조회
            const detail = await r.text().catch(() => '');
            if (!/band_cabinet/.test(detail)) return { err: json({ error: 'profile lookup failed', status: 400, detail: detail.slice(0, 300) }, 502) };
            r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=${PROFILE_SEL_NO_CABINET}&limit=1`, { headers: sbHeaders });
        }
        if (!r.ok) return { err: json({ error: 'profile lookup failed', status: r.status, detail: (await r.text().catch(() => '')).slice(0, 300) }, 502) };
        const [p] = await r.json().catch(() => []);
        return { p };
    };
    const getClaims = async (id, statuses) => {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/band_slot_claims?profile_id=eq.${encodeURIComponent(id)}&status=in.(${statuses.join(',')})&select=day_of_week,start_time,end_time,status&order=day_of_week`, { headers: sbHeaders });
        return r.ok ? (await r.json().catch(() => [])) : []; // 표가 없으면(마이그레이션 전) timeslots 로 폴백
    };
    const phoneOf = (p) => String(p.leader_phone || p.phone || '').replace(/\D/g, '');
    const PHONE_RE = /^01[016789][0-9]{7,8}$/;

    // ── 운영자 테스트: 본인 번호로 [테스트] 문구만, 기록 없음
    if (body.band_test) {
        const kind = String(body.band_test);
        if (!BAND_TEXT[kind]) return json({ ok: false, error: 'bad-kind' }, 400);
        if (!smsOn) return json({ ok: false, error: 'sms-disabled', message: '솔라피 키(SOLAPI_API_KEY/SECRET, SMS_SENDER)가 설정되지 않았습니다.' }, 400);
        const uid = await verifySb(env, body.sb_token);
        if (!uid) return json({ ok: false, error: 'auth', message: '로그인이 만료되었습니다. 다시 로그인해주세요.' }, 401);
        const { p: me, err } = await getProfile(uid); if (err) return err;
        if (!me || me.member_type !== 'band' || !isAdminBand(me)) return json({ ok: false, error: 'forbidden', message: '게더링 관리자 계정만 사용할 수 있습니다.' }, 403);
        const to = phoneOf(me);
        if (!PHONE_RE.test(to)) return json({ ok: false, error: 'bad-phone', message: '관리자 계정의 휴대폰 번호가 올바르지 않습니다.' }, 400);
        const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        const sample = { ...BAND_SAMPLE, band_start_date: ymdAdd(today, 9) };
        const text = '[테스트] ' + BAND_TEXT[kind](sample, [{ day_of_week: 5, start_time: '18:00', end_time: '23:00' }]);
        const smsRes = await solapiSend(env, to, text, BAND_SUBJECT[kind] + '(테스트)');
        if (!smsRes.ok) return json({ ok: false, error: 'solapi', message: '문자 발송에 실패했습니다.', status: smsRes.status, detail: (await smsRes.text().catch(() => '')).slice(0, 300) }, 502);
        return json({ ok: true, to: maskPhone(to), kind, test: true });
    }

    // ── 대상·종류·권한
    let kind, targetId, resend = false;
    if (body.band_signup_id) {
        kind = 'signup'; targetId = String(body.band_signup_id);
        if (!UUID_RE.test(targetId)) return json({ error: 'invalid band_signup_id' }, 400);
        if (!smsOn) return json({ ok: false, skipped: 'sms-disabled' });
    } else {
        kind = String(body.kind || ''); targetId = String(body.band_profile_id || '');
        if (!['approve', 'reject'].includes(kind)) return json({ ok: false, error: 'bad-kind' }, 400);
        if (!UUID_RE.test(targetId)) return json({ error: 'invalid band_profile_id' }, 400);
        if (!smsOn) return json({ ok: false, error: 'sms-disabled', message: '솔라피 키가 설정되지 않아 문자를 보내지 않았습니다.' }, 400);
        const uid = await verifySb(env, body.sb_token);
        if (!uid) return json({ ok: false, error: 'auth', message: '로그인이 만료되었습니다. 다시 로그인해주세요.' }, 401);
        const { p: me, err } = await getProfile(uid); if (err) return err;
        if (!me || me.member_type !== 'band' || !isAdminBand(me)) return json({ ok: false, error: 'forbidden', message: '게더링 관리자 계정만 보낼 수 있습니다.' }, 403);
        resend = body.resend === true;
    }
    const { p, err } = await getProfile(targetId); if (err) return err;
    if (!p || p.member_type !== 'band') return json({ ok: false, error: 'not-found', message: '팀을 찾을 수 없습니다.' }, 404);
    const want = kind === 'signup' ? 'pending' : kind === 'approve' ? 'approved' : 'rejected';
    if ((p.status || 'pending') !== want) return json({ ok: false, error: 'status', message: `팀 상태(${p.status || 'pending'})가 ${want} 가 아니어서 보내지 않았습니다.` }, 409);
    if (kind === 'signup' && p.created_at && Date.now() - Date.parse(p.created_at) > 15 * 60 * 1000) return json({ ok: false, skipped: 'stale' });
    const to = phoneOf(p);
    if (!PHONE_RE.test(to)) return json({ ok: false, error: 'bad-phone', skipped: 'bad-phone', message: '팀 리더 휴대폰 번호가 올바르지 않습니다.' }, kind === 'signup' ? 200 : 400);

    // ── 1회 선점: band_sms_log(profile_id, kind) PK. resend 는 upsert(merge) 로 통과
    const claimTs = new Date().toISOString();
    const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/band_sms_log`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: resend ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal' },
        body: JSON.stringify({ profile_id: targetId, kind, sent_at: claimTs, to_phone: maskPhone(to) }),
    });
    if (claimRes.status === 409) return json({ ok: false, skipped: 'already-sent', message: '이미 보낸 문자입니다.' }, kind === 'signup' ? 200 : 409);
    if (!claimRes.ok) {
        const detail = (await claimRes.text().catch(() => '')).slice(0, 300);
        const noTable = claimRes.status === 404 || /band_sms_log/.test(detail);
        return json({ ok: false, error: noTable ? 'no-table' : 'claim failed', skipped: noTable ? 'no-table' : undefined, status: claimRes.status, detail,
            message: noTable ? '발송 기록 표(band_sms_log)가 없습니다. 20261107_band_sms_log.sql 을 실행해주세요.' : '발송 기록을 남기지 못해 보내지 않았습니다.' }, kind === 'signup' ? 200 : 502);
    }

    const claims = await getClaims(targetId, kind === 'approve' ? ['approved'] : ['pending', 'approved']);
    const text = BAND_TEXT[kind](p, claims);
    const smsRes = await solapiSend(env, to, text, BAND_SUBJECT[kind]);
    if (!smsRes.ok) {
        // 실패 → 내가 찍은 선점(sent_at 일치)만 지워 다음 시도 여지를 남긴다
        await fetch(`${SUPABASE_URL}/rest/v1/band_sms_log?profile_id=eq.${encodeURIComponent(targetId)}&kind=eq.${kind}&sent_at=eq.${encodeURIComponent(claimTs)}`,
            { method: 'DELETE', headers: sbHeaders }).catch(() => {});
        return json({ ok: false, error: 'solapi send failed', message: '문자 발송에 실패했습니다.', status: smsRes.status, detail: (await smsRes.text().catch(() => '')).slice(0, 300) }, 502);
    }
    return json({ ok: true, to: maskPhone(to), kind });
}

// 진단용 솔라피 조회 (발송 없음)
async function solapiGet(path, env) {
    const res = await fetch('https://api.solapi.com' + path, {
        headers: { Authorization: await solapiAuthHeader(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET) },
    });
    const body = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body };
}
const parseMaybe = (s) => { try { return JSON.parse(s); } catch { return s; } };
const maskPhone = (v) => String(v).replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // GET: 브라우저로 열어보는 셀프 진단 — 키 원문·개인정보 없이 설정 상태만 보여준다.
    if (request.method === 'GET') {
        const out = { 시각: new Date().toISOString() };
        try {
            out.환경변수_SUPABASE = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
            out.환경변수_SOLAPI = !!(env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SMS_SENDER);
            if (out.환경변수_SUPABASE) {
                const sbHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
                const colRes = await fetch(
                    `${env.SUPABASE_URL}/rest/v1/performance_bookings?select=created_at,sms_sent_at&order=created_at.desc&limit=1`,
                    { headers: sbHeaders });
                out.sms_sent_at_컬럼 = colRes.ok;
                if (colRes.ok) {
                    const [row] = await colRes.json().catch(() => []);
                    out.최근_접수건 = row ? { 접수시각: row.created_at, 문자발송기록: !!row.sms_sent_at } : '접수 내역 없음';
                } else {
                    out.컬럼_오류 = (await colRes.text().catch(() => '')).slice(0, 200);
                }
                // 고정팀 문자(2026-11-07): 발송 기록 표·캐비넷 컬럼 유무 — 없으면 어떤 마이그레이션을 돌려야 하는지 바로 보인다
                try {
                    const logRes = await fetch(`${env.SUPABASE_URL}/rest/v1/band_sms_log?select=kind,sent_at,to_phone&order=sent_at.desc&limit=5`, { headers: sbHeaders });
                    out.고정팀_문자기록_표 = logRes.ok ? true : `없음 — supabase/migrations/20261107_band_sms_log.sql 실행 필요 (${logRes.status})`;
                    if (logRes.ok) out.최근_고정팀_문자 = await logRes.json().catch(() => []);
                } catch (e) { out.고정팀_문자기록_표 = '확인 실패: ' + String(e && e.message || e); }
                try {
                    const cabRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=band_cabinet&limit=1`, { headers: sbHeaders });
                    out.캐비넷_컬럼 = cabRes.ok ? true : '없음 — supabase/migrations/20261107_band_cabinet.sql 실행 필요';
                } catch (e) { out.캐비넷_컬럼 = '확인 실패: ' + String(e && e.message || e); }
            }
            if (out.환경변수_SOLAPI) {
                const bal = await solapiGet('/cash/v1/balance', env);
                out.솔라피_키인증 = bal.ok ? { ok: true, 잔액: parseMaybe(bal.body) }
                    : { ok: false, status: bal.status, detail: bal.body.slice(0, 200) };
                const snd = await solapiGet('/senderid/v1/numbers/active', env);
                if (snd.ok) {
                    const raw = parseMaybe(snd.body);
                    const nums = (Array.isArray(raw) ? raw : []).map(n =>
                        String(typeof n === 'string' ? n : (n && (n.phoneNumber || n.number)) || '').replace(/\D/g, ''));
                    const sender = String(env.SMS_SENDER).replace(/\D/g, '');
                    out.솔라피_발신번호목록 = nums.map(maskPhone);
                    out.발신번호_등록됨 = nums.includes(sender);
                } else {
                    out.솔라피_발신번호목록 = { ok: false, status: snd.status, detail: snd.body.slice(0, 200) };
                }
            }
        } catch (e) {
            out.진단_오류 = String(e && e.message || e);
        }
        return json(out);
    }

    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    try {
        const body = await request.json().catch(() => ({}));
        if (body && (body.band_signup_id || body.band_profile_id || body.band_test)) return await handleBandSms(body, env, json);
        const { booking_id } = body || {};
        if (!UUID_RE.test(String(booking_id || ''))) {
            return json({ error: 'invalid booking_id' }, 400);
        }

        const SUPABASE_URL = env.SUPABASE_URL;
        const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'missing SUPABASE env vars' }, 500);
        // 솔라피 키 미설정 = 기능 꺼짐. 클라이언트는 fire-and-forget이므로 조용히 스킵.
        if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SMS_SENDER) {
            return json({ ok: false, skipped: 'sms-disabled' });
        }

        const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
        // select=* — booking_code 컬럼 마이그레이션(20260829) 전에도 조회가 깨지지 않도록 명시 목록 대신 전체
        const sel = '*';
        const getRes = await fetch(
            `${SUPABASE_URL}/rest/v1/performance_bookings?id=eq.${booking_id}&select=${sel}&limit=1`,
            { headers: sbHeaders });
        if (!getRes.ok) {
            return json({ error: 'booking lookup failed', status: getRes.status,
                detail: (await getRes.text().catch(() => '')).slice(0, 300) }, 502);
        }
        const [bk] = await getRes.json();
        if (!bk) return json({ error: 'booking not found' }, 404);
        if (bk.sms_sent_at) return json({ ok: false, skipped: 'already-sent' });
        if (Date.now() - new Date(bk.created_at).getTime() > 15 * 60 * 1000) {
            return json({ ok: false, skipped: 'stale' });
        }
        const to = String(bk.phone || '').replace(/\D/g, '');
        if (!/^01[016789][0-9]{7,8}$/.test(to)) return json({ ok: false, skipped: 'bad-phone' });

        // 동시 호출 대비 선점: sms_sent_at이 아직 null인 행만 갱신되고, 갱신된 행이 없으면 남이 이미 선점한 것
        const claimTs = new Date().toISOString();
        const claimRes = await fetch(
            `${SUPABASE_URL}/rest/v1/performance_bookings?id=eq.${booking_id}&sms_sent_at=is.null`,
            { method: 'PATCH',
              headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify({ sms_sent_at: claimTs }) });
        if (!claimRes.ok) {
            return json({ error: 'claim failed', status: claimRes.status,
                detail: (await claimRes.text().catch(() => '')).slice(0, 300) }, 502);
        }
        const claimed = await claimRes.json().catch(() => []);
        if (!Array.isArray(claimed) || claimed.length === 0) {
            return json({ ok: false, skipped: 'already-sent' });
        }

        const smsRes = await fetch('https://api.solapi.com/messages/v4/send', {
            method: 'POST',
            headers: {
                Authorization: await solapiAuthHeader(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: {
                to, from: String(env.SMS_SENDER).replace(/\D/g, ''), text: buildText(bk),
                // LMS는 제목이 규격상 필수라 미지정 시 본문 첫 40byte가 자동 복사돼
                // 수신 화면에 첫 줄이 잘린 채 두 번 보인다. 명시 지정(40byte 이내).
                subject: '게더 올 어라운드 예약 안내',
            } }),
        });
        if (!smsRes.ok) {
            // 발송 실패 → 내가 찍은 선점만 되돌려(타임스탬프 일치 조건) 다음 시도 여지를 남긴다
            await fetch(
                `${SUPABASE_URL}/rest/v1/performance_bookings?id=eq.${booking_id}&sms_sent_at=eq.${encodeURIComponent(claimTs)}`,
                { method: 'PATCH', headers: { ...sbHeaders, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sms_sent_at: null }) }).catch(() => {});
            return json({ ok: false, error: 'solapi send failed', status: smsRes.status,
                detail: (await smsRes.text().catch(() => '')).slice(0, 300) }, 502);
        }
        return json({ ok: true });
    } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
    }
}
