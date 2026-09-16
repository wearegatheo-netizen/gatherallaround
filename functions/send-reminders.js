// Cloudflare Pages Function: /send-reminders
// 1) 공간 대관 이용일 임박(D-2) 관리자 푸시 알림
// 2) 고정 합주팀 회차 이용료(월세) 입금 안내 문자 — 미납 시 회차당 최대 3회(입금일·시작 1주 전·시작 전날), 발송 시 관리자 푸시
// 3) 매월 1일 개인정보 보유기간 만료 건 파기
// 1)·3)은 매일 08:00 KST(perf-reminder.yml, scope=booking), 2)는 12:00 KST(band-rent-sms.yml, scope=band) 크론이 POST로 호출한다.
//
// 1) 크론이 하루 건너뛰어도 따라잡을 수 있게 오늘(KST)~이틀 뒤 사이의 승인 예약 중
//    아직 알림이 안 나간 건을 전부 처리한다 (D-2가 기본, 놓친 건은 D-1/D-DAY로 발송).
// 2) 회차 모델(index.html bandCycle* · 내부운영 시트 "진행중인 고정팀"과 동일하게 유지할 것):
//      시작일_n = band_start_date + 28n, 종료일_n = 시작일_n + 21, 입금일_n = 시작일_n − 14 (n≥1, 3주차 사용일 = 다음 시작일 2주 전)
//    미납이면 회차당 최대 3회: 입금일 당일(kind 'due', 3주차) → 시작 1주 전(kind 'week4', 4주차) → 시작 전날(kind 'last').
//    크론이 빠진 날은 다음 실행에서 캐치업(due·week4 는 시작 전까지, last 는 전날만), 하루 한 팀 최대 1건.
//    호출 scope: {scope:'booking'}(08:00 크론 — 대관 D-2 푸시·파기) / {scope:'band'}(12:00 크론 — 합주팀 문자) / 없음 = 둘 다.
//    관리자 문자 테스트: POST {action:'test_band_sms', sb_token} — 게더링 밴드 계정(Supabase 세션)만, 본인 번호로만 발송.
//    band_rent_reminders(team_id, cycle_no, kind) PK 로 회차·종류별 평생 1회 선점. 관리자 팀(게더링)은 제외.
//    솔라피 키가 없으면 이 블록은 조용히 꺼진다(/send-sms 와 같은 정책).
// 3) 파기: 매월 1일(KST) 호출이면 이용일·접수일이 모두 1년 넘게 지난 행을 DELETE —
//    신청 폼 개인정보 동의 문구("이용 종료 후 1년 보관 후 파기") 이행.
//
// 시크릿 없이 공개 호출 가능하지만 남용이 무해한 설계:
//   발송 전 reminder_sent_at(대관) / band_rent_reminders 행(월세)을 선점 — 같은 건은 평생 1회만
//   발송되므로 반복 호출해 봐야 "정해진 날 아침 알림"이 몇 시간 당겨지는 것 이상은 불가능하다.
// 푸시 전송 자체는 기존 /notify-admins → /push (VAPID) 경로를 그대로 재사용.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (월세 문자) SOLAPI_API_KEY, SOLAPI_API_SECRET, SMS_SENDER
// 사전 준비(1회, Supabase SQL Editor): supabase/migrations/20260831_reminder.sql, 20260915_band_cycles.sql

function corsFor(origin) {
    const host = (() => { try { return new URL(origin).hostname; } catch { return ''; } })();
    const allowed = origin && (
        origin === 'https://gatherallaround.com' ||
        origin === 'https://www.gatherallaround.com' ||
        /\.(pages\.dev|gatherallaround\.com)$/.test(host)
    );
    return {
        'Access-Control-Allow-Origin': allowed ? origin : 'https://gatherallaround.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
}

// KST(UTC+9, DST 없음) 기준 날짜 문자열. offsetDays 만큼 더한 날짜.
const kstDateStr = (offsetDays = 0) =>
    new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

// 알림 본문 — 접수 푸시(sendAdminPush)와 같은 톤. end_time은 마지막 슬롯 시작(22:00=실종료 23:00).
function reminderText(bk, todayStr) {
    const [, m, d] = bk.date.split('-').map(Number);
    const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(bk.date + 'T00:00:00Z').getUTCDay()];
    const sh = parseInt(bk.start_time, 10);
    const eh = parseInt(bk.end_time, 10) + 1;
    const diff = Math.round((Date.parse(bk.date) - Date.parse(todayStr)) / 86400e3);
    const dday = diff <= 0 ? 'D-DAY' : `D-${diff}`;
    return {
        title: `⏰ 공간 대관 ${dday}`,
        body: `${bk.name || ''} · ${m}/${d}(${wd}) ${sh}-${eh}시 · ${bk.headcount}명${bk.booking_code ? ' · ' + bk.booking_code : ''}`,
    };
}

// ── 고정 합주팀 회차 수식 (index.html bandCycle* 와 동일) ─────────────────────
const BAND_CYCLE_DAYS = 28;
const DAY_MS = 86400e3;
const GATHEO_ADMIN_BAND_ID = 'wearegatheo'; // index.html GATHEO_ADMIN_BAND_ID 와 동일 — 관리자 팀은 문자 대상 아님
const BAND_BANK_LINE = '토스뱅크 1000-2274-7678 최경수'; // send-sms.js buildText · index.html 대관 조회 카드와 동일 문자열 유지
export const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * DAY_MS).toISOString().slice(0, 10);
export const bandCycleStart = (start, n) => addDays(start, BAND_CYCLE_DAYS * n);
export const bandCycleEnd = (start, n) => addDays(start, BAND_CYCLE_DAYS * n + 21);
export const BAND_DUE_OFFSET = 14; // 입금일 = 다음 회차 시작일 − 14일 (3주차 사용일)
export const bandCycleDue = (start, n) => (n <= 0 ? start : addDays(start, BAND_CYCLE_DAYS * n - BAND_DUE_OFFSET));
// 다음 회차 번호: 오늘이 속한 회차 + 1 (시작일 전이면 0 = 등록 회차, 문자 대상 아님)
export const bandNextCycle = (start, today) => {
    const days = Math.round((Date.parse(today) - Date.parse(start)) / DAY_MS);
    return days < 0 ? 0 : Math.floor(days / BAND_CYCLE_DAYS) + 1;
};
// 구형 납부 행(cycle_no 없음) 귀속: 회차 n 의 납부 창 = [시작일_n − 21, 시작일_n + 7) — 입금일(시작 2주 전) 일주일 앞부터 시작 후 일주일까지
export const bandInferCycle = (start, paidAt) =>
    Math.max(0, Math.floor(((Date.parse(paidAt) - Date.parse(start)) / DAY_MS + 21) / BAND_CYCLE_DAYS));

const isAdminBand = (t) => {
    const loginId = String(t.instruments || '').trim().toLowerCase();
    const emailId = String(t.email || '').trim().toLowerCase().split('@')[0];
    return loginId === GATHEO_ADMIN_BAND_ID || emailId === GATHEO_ADMIN_BAND_ID;
};
const mdOf = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${m}/${d}`; };
const wdOf = (ymd) => ['일', '월', '화', '수', '목', '금', '토'][new Date(ymd + 'T00:00:00Z').getUTCDay()];

// 입금 안내 문자. 90byte 초과 → 솔라피가 LMS로 자동 전환. 이모지는 EUC-KR에서 깨질 수 있어 넣지 않는다.
export function bandRentText(team, n, kind, today) {
    const start = team.band_start_date;
    const startN = bandCycleStart(start, n);
    const due = bandCycleDue(start, n);
    const name = team.band_name_kr || team.name || '';
    const cycle = `[${name}] 팀 고정 합주 다음 회차(${mdOf(startN)}(${wdOf(startN)})부터 4주)`;
    const lead = kind === 'last'
        ? `${cycle}가 내일 시작됩니다. 아직 입금 확인이 되지 않아 안내드립니다.`
        : kind === 'week4'
        ? `${cycle} 시작이 일주일 남았습니다. 아직 입금 확인이 되지 않아 안내드립니다.`
        : today > due
            ? `${cycle} 이용료 입금일(${mdOf(due)})이 지났습니다. 아직 입금 확인이 되지 않아 안내드립니다.`
            : `${cycle} 이용료 입금일이 오늘(${mdOf(due)})입니다.`;
    const fee = Number(team.band_fee) > 0 ? `이용료(${Number(team.band_fee).toLocaleString('ko-KR')}원)` : '이용료';
    return `안녕하세요! 신촌 프리미엄 밴드 스튜디오 게더 올 어라운드(Gather all around)입니다.

${lead}

${fee}를 아래 계좌로 입금해주시면 다음 회차 이용이 연장됩니다.

${BAND_BANK_LINE}

※ 연장하지 않으실 경우 미리 말씀해주시면 감사하겠습니다. 보증금은 사용 종료 시 반환됩니다.`;
}

// Supabase 세션 토큰 검증 — GoTrue 가 토큰 주인을 돌려준다 (밴드 계정은 Supabase auth 로그인)
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
const maskPhone = (v) => String(v).replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');

// 솔라피 인증 — send-sms.js 와 동일 (Pages Functions 는 파일별 격리 Worker 라 복사해 둔다)
const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function solapiAuthHeader(apiKey, apiSecret) {
    const date = new Date().toISOString();
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(apiSecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt)));
    return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 오늘 문자를 보내야 할 팀·회차·종류 목록 (선점·발송 없음). 하루 한 팀 최대 1건.
export function bandRentTargets(teams, payments, reminders, today) {
    const paidSet = new Set();
    for (const p of payments || []) {
        const team = teams.find(t => t.id === p.team_id);
        if (!team || !p.paid_at) continue;
        const n = Number.isInteger(p.cycle_no) ? p.cycle_no : bandInferCycle(team.band_start_date, p.paid_at);
        paidSet.add(`${p.team_id}:${n}`);
    }
    const sentSet = new Set((reminders || []).map(r => `${r.team_id}:${r.cycle_no}:${r.kind}`));
    const out = [];
    for (const t of teams) {
        const n = bandNextCycle(t.band_start_date, today);
        if (n < 1 || paidSet.has(`${t.id}:${n}`)) continue;
        const due = bandCycleDue(t.band_start_date, n);
        const startN = bandCycleStart(t.band_start_date, n);
        if (today < due || today >= startN) continue;
        const sent = (k) => sentSet.has(`${t.id}:${n}:${k}`);
        if (!sent('due')) out.push({ team: t, n, kind: 'due', due, startN });                                                   // 3주차(입금일)~
        else if (today >= addDays(startN, -7) && !sent('week4')) out.push({ team: t, n, kind: 'week4', due, startN });          // 4주차(시작 1주 전)~
        else if (today === addDays(startN, -1) && !sent('last')) out.push({ team: t, n, kind: 'last', due, startN });           // 시작 전날만
    }
    return out;
}

async function loadBandRentTargets(env, sbHeaders, today) {
    const base = `${env.SUPABASE_URL}/rest/v1/`;
    const sel = 'id,name,band_name_kr,leader_phone,phone,band_start_date,band_fee,instruments,email';
    const tRes = await fetch(`${base}profiles?member_type=eq.band&status=eq.approved&band_start_date=not.is.null&band_ended_at=is.null&select=${sel}`,
        { headers: sbHeaders });
    if (!tRes.ok) throw new Error('band teams lookup failed: ' + tRes.status);
    const teams = (await tRes.json().catch(() => [])).filter(t => t && t.band_start_date && !isAdminBand(t));
    if (!teams.length) return [];
    const ids = teams.map(t => t.id).join(',');
    const [pRes, rRes] = await Promise.all([
        fetch(`${base}band_payments?team_id=in.(${ids})&select=team_id,paid_at,cycle_no`, { headers: sbHeaders }),
        fetch(`${base}band_rent_reminders?team_id=in.(${ids})&select=team_id,cycle_no,kind`, { headers: sbHeaders }),
    ]);
    const payments = pRes.ok ? await pRes.json().catch(() => []) : [];
    const reminders = rRes.ok ? await rRes.json().catch(() => []) : [];
    return bandRentTargets(teams, payments, reminders, today);
}

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const SUPABASE_URL = env.SUPABASE_URL;
    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'missing SUPABASE env vars' }, 500);
    const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

    const today = kstDateStr(0);
    const until = kstDateStr(2);
    const smsOn = !!(env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SMS_SENDER);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

    // ── 관리자 문자 테스트: 게더링 밴드 계정이 본인 번호로 입금 안내 문자 샘플을 받아 본다 (선점·이력 기록 없음)
    if (request.method === 'POST' && body && body.action === 'test_band_sms') {
        if (!smsOn) return json({ ok: false, error: 'sms-disabled', message: '솔라피 키(SOLAPI_API_KEY/SECRET, SMS_SENDER)가 설정되지 않았습니다.' }, 400);
        const uid = await verifySb(env, body.sb_token);
        if (!uid) return json({ ok: false, error: 'auth', message: '로그인이 만료되었습니다. 다시 로그인해주세요.' }, 401);
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,name,band_name_kr,leader_phone,phone,instruments,email,member_type,band_start_date,band_fee&limit=1`,
            { headers: sbHeaders });
        const [prof] = pr.ok ? await pr.json().catch(() => []) : [];
        if (!prof || prof.member_type !== 'band' || !isAdminBand(prof)) return json({ ok: false, error: 'forbidden', message: '게더링 관리자 계정만 사용할 수 있습니다.' }, 403);
        const to = String(prof.leader_phone || prof.phone || '').replace(/\D/g, '');
        if (!/^01[016789][0-9]{7,8}$/.test(to)) return json({ ok: false, error: 'bad-phone', message: '관리자 계정의 휴대폰 번호가 올바르지 않습니다.' }, 400);
        const kind = ['due', 'week4', 'last'].includes(body.kind) ? body.kind : 'due';
        // 샘플: 오늘이 해당 발송일(입금일 = 시작일 + 14 / 4주차 = +21 / 전날 = +27)이 되도록 시작일을 잡는다 → 문구가 실제 발송 시와 같다
        const back = kind === 'last' ? 27 : kind === 'week4' ? 21 : BAND_DUE_OFFSET;
        const sample = { band_name_kr: prof.band_name_kr || prof.name || '게더링', band_start_date: addDays(today, -back), band_fee: prof.band_fee || 300000 };
        const text = '[테스트] ' + bandRentText(sample, 1, kind, today);
        const smsRes = await fetch('https://api.solapi.com/messages/v4/send', {
            method: 'POST',
            headers: { Authorization: await solapiAuthHeader(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET), 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { to, from: String(env.SMS_SENDER).replace(/\D/g, ''), text, subject: '게더 올 어라운드 이용료 안내(테스트)' } }),
        });
        if (!smsRes.ok) return json({ ok: false, error: 'solapi', message: '문자 발송에 실패했습니다.', status: smsRes.status, detail: (await smsRes.text().catch(() => '')).slice(0, 300) }, 502);
        return json({ ok: true, to: maskPhone(to), kind, preview: text });
    }

    const listUrl = `${SUPABASE_URL}/rest/v1/performance_bookings`
        + `?status=eq.approved&reminder_sent_at=is.null&date=gte.${today}&date=lte.${until}&select=*`;

    try {
        const listRes = await fetch(listUrl, { headers: sbHeaders });
        if (!listRes.ok) {
            return json({ error: 'booking lookup failed', status: listRes.status,
                detail: (await listRes.text().catch(() => '')).slice(0, 300) }, 502);
        }
        const rows = await listRes.json();
        const bookings = Array.isArray(rows) ? rows : [];

        // scope: 'booking'(대관 푸시·파기만) / 'band'(합주팀 문자만) / 그 외 둘 다. GET 드라이런은 항상 둘 다 보여준다.
        const scope = body && (body.scope === 'booking' || body.scope === 'band') ? body.scope : 'all';
        // 월세 문자: 솔라피 키 미설정 = 기능 꺼짐 (조회조차 하지 않는다)
        const bandTargets = smsOn && (request.method === 'GET' || scope !== 'booking') ? await loadBandRentTargets(env, sbHeaders, today) : [];

        // GET: 드라이런 진단 — 발송·선점 없이 대상 요약만 (공개 응답이므로 개인정보 제외)
        if (request.method === 'GET') {
            return json({ 오늘_KST: today, 대상_기간: `${today} ~ ${until}`,
                발송_대기: bookings.length, 대상_이용일: bookings.map(b => b.date),
                월세_문자: smsOn ? '켜짐' : '꺼짐(솔라피 키 없음)',
                월세_발송_대기: bandTargets.map(x => ({ 회차: x.n, 입금일: x.due, 종류: x.kind })) });
        }
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

        const origin = new URL(request.url).origin;
        let sent = 0;
        for (const bk of (scope === 'band' ? [] : bookings)) {
            // 선점: reminder_sent_at이 아직 null인 행만 — 갱신된 행이 없으면 남이 이미 처리한 것
            const claimRes = await fetch(
                `${SUPABASE_URL}/rest/v1/performance_bookings?id=eq.${bk.id}&reminder_sent_at=is.null`,
                { method: 'PATCH',
                  headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
                  body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }) });
            if (!claimRes.ok) continue;
            const claimed = await claimRes.json().catch(() => []);
            if (!Array.isArray(claimed) || claimed.length === 0) continue;

            const { title, body } = reminderText(bk, today);
            // 푸시 실패 시에도 선점은 유지 — 매일 재시도로 관리자를 시달리게 하지 않는다
            await fetch(`${origin}/notify-admins`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, body, roles: ['운영 총괄'] }), // D-2 알림은 운영 총괄만
            }).catch(() => {});
            sent++;
        }

        // 고정 합주팀 입금 안내 문자 — band_rent_reminders 행 INSERT 로 선점(PK 중복 = 이미 발송 → 409 → skip)
        let bandSent = 0;
        for (const x of bandTargets) {
            const to = String(x.team.leader_phone || x.team.phone || '').replace(/\D/g, '');
            if (!/^01[016789][0-9]{7,8}$/.test(to)) continue;
            const claimTs = new Date().toISOString();
            const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/band_rent_reminders`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
                body: JSON.stringify({ team_id: x.team.id, cycle_no: x.n, kind: x.kind, sent_at: claimTs }),
            });
            if (!claimRes.ok) continue;
            const smsRes = await fetch('https://api.solapi.com/messages/v4/send', {
                method: 'POST',
                headers: { Authorization: await solapiAuthHeader(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET), 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: {
                    to, from: String(env.SMS_SENDER).replace(/\D/g, ''), text: bandRentText(x.team, x.n, x.kind, today),
                    subject: '게더 올 어라운드 이용료 안내', // LMS 제목(40byte 이내) — 미지정 시 본문 첫 줄이 잘려 두 번 보인다
                } }),
            });
            if (!smsRes.ok) {
                // 발송 실패 → 내가 찍은 선점만 되돌려(타임스탬프 일치 조건) 다음 날 재시도 여지를 남긴다
                await fetch(`${SUPABASE_URL}/rest/v1/band_rent_reminders?team_id=eq.${x.team.id}&cycle_no=eq.${x.n}&kind=eq.${x.kind}&sent_at=eq.${encodeURIComponent(claimTs)}`,
                    { method: 'DELETE', headers: sbHeaders }).catch(() => {});
                continue;
            }
            bandSent++;
            const name = x.team.band_name_kr || x.team.name || '';
            await fetch(`${origin}/notify-admins`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: '💰 월세 입금 안내 문자 발송',
                    body: `${name} · ${x.n}차 · 입금일 ${mdOf(x.due)} · ${{ due: '입금일 안내', week4: '시작 1주 전', last: '시작 전날' }[x.kind] || x.kind}`,
                    roles: ['운영 총괄'] }),
            }).catch(() => {});
        }

        // 매월 1일(KST): 보유기간(1년) 만료 건 파기 — 이용일과 접수일이 모두 1년 경과한 행만.
        // 며칠 지나 실행돼도 같은 집합을 지우는 멱등 동작이라 반복·지연 호출 모두 안전하다.
        let purged = 0;
        if (today.endsWith('-01') && scope !== 'band') {
            const cutoffDate = kstDateStr(-365);
            const cutoffTs = new Date(Date.now() - 365 * 86400e3).toISOString();
            const delRes = await fetch(
                `${SUPABASE_URL}/rest/v1/performance_bookings?date=lt.${cutoffDate}&created_at=lt.${cutoffTs}&select=id`,
                { method: 'DELETE', headers: { ...sbHeaders, Prefer: 'return=representation' } });
            if (delRes.ok) {
                const deleted = await delRes.json().catch(() => []);
                purged = Array.isArray(deleted) ? deleted.length : 0;
            }
        }
        return json({ ok: true, scope, checked: scope === 'band' ? 0 : bookings.length, sent, purged,
            band_checked: bandTargets.length, band_sent: bandSent, ...(smsOn ? {} : { band: 'sms-disabled' }) });
    } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
    }
}
