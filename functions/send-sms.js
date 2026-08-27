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

토스뱅크 1002-1793-5417 최경수

※ 신청 후 4시간 안에 입금 확인이 되지 않으면 예약이 자동 취소됩니다.
※ 예약 상태는 홈페이지 [공간 대관 > 예약 조회]에서 예약번호와 연락처로 확인하실 수 있습니다.
※ 기준 인원 수(5명)를 초과하는 인원에 대해 변동이 있을시 추가 1명당 5천원이 지불됩니다. 변동시 이용 전날까지 말씀주시면 감사하겠습니다.`;
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
