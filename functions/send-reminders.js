// Cloudflare Pages Function: /send-reminders
// 공간 대관 이용일 임박(D-2) 관리자 푸시 알림.
// 매일 08:00 KST에 GitHub Actions 크론(.github/workflows/perf-reminder.yml)이 POST로 호출한다.
// 크론이 하루 건너뛰어도 따라잡을 수 있게 오늘(KST)~이틀 뒤 사이의 승인 예약 중
// 아직 알림이 안 나간 건을 전부 처리한다 (D-2가 기본, 놓친 건은 D-1/D-DAY로 발송).
//
// 시크릿 없이 공개 호출 가능하지만 남용이 무해한 설계:
//   발송 전 reminder_sent_at 을 조건부 PATCH로 선점 — 같은 건은 평생 1회만 발송되므로
//   반복 호출해 봐야 "정해진 날 아침 알림"이 몇 시간 당겨지는 것 이상은 불가능하다.
// 푸시 전송 자체는 기존 /notify-admins → /push (VAPID) 경로를 그대로 재사용.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 사전 준비(1회, Supabase SQL Editor): supabase/migrations/20260831_reminder.sql

function corsFor(origin) {
    const host = (() => { try { return new URL(origin).hostname; } catch { return ''; } })();
    const allowed = origin && (
        origin === 'https://gatherallaround.co.kr' ||
        origin === 'https://www.gatherallaround.co.kr' ||
        /\.(pages\.dev|gatherallaround\.co\.kr)$/.test(host)
    );
    return {
        'Access-Control-Allow-Origin': allowed ? origin : 'https://gatherallaround.co.kr',
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

        // GET: 드라이런 진단 — 발송·선점 없이 대상 요약만 (공개 응답이므로 개인정보 제외)
        if (request.method === 'GET') {
            return json({ 오늘_KST: today, 대상_기간: `${today} ~ ${until}`,
                발송_대기: bookings.length, 대상_이용일: bookings.map(b => b.date) });
        }
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

        const origin = new URL(request.url).origin;
        let sent = 0;
        for (const bk of bookings) {
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
        return json({ ok: true, checked: bookings.length, sent });
    } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
    }
}
