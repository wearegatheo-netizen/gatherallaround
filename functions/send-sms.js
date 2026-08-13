// Cloudflare Pages Function: /send-sms
// 공간 대관 접수 직후, 신청자 연락처로 접수 확인 문자를 1회 발송한다 (솔라피 API).
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

// 한글 2byte 기준 90byte 이내 → 단문(SMS)으로 발송됨. 문구 수정 시 길이 주의.
function buildText(bk) {
    const [, m, d] = bk.date.split('-').map(Number);
    // end_time은 마지막 이용 슬롯의 시작(예: 22:00 = 실제 종료 23:00) — 관리자 화면과 동일 규칙
    const end = String(parseInt(bk.end_time, 10) + 1).padStart(2, '0') + ':00';
    return `[게더올어라운드] ${m}/${d} ${bk.start_time}~${end} 공간대관 신청 접수완료. 확정시 별도 안내드립니다.`;
}

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    try {
        const { booking_id } = await request.json().catch(() => ({}));
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(booking_id || ''))) {
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
        const sel = 'id,phone,date,start_time,end_time,created_at,sms_sent_at';
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
