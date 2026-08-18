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

        return fail(400, 'unknown_action', '알 수 없는 요청입니다.');
    } catch (e) {
        return json({ ok: false, error: 'internal', message: '서버 오류가 발생했습니다.', detail: String(e && e.message || e) }, 500);
    }
}
