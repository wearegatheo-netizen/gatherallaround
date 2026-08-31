// Cloudflare Pages Function: /send-email
// 커뮤니티 모임 신청 접수 시 모임장에게 알림 메일을 1회 발송한다 (Resend API).
// 원래 Supabase Edge Function('send-email')을 호출하던 기능인데, 함수가 배포돼 있지
// 않아 "Failed to send a request to the Edge Function" 오류가 났다 — 문자(/send-sms)와
// 같은 Cloudflare 함수로 이관.
//
// 공개 페이지에서 호출되므로 요청을 그대로 믿지 않는다:
//   1) 본문은 {meeting_id, application_id}만 받고, 수신자·제목·내용은 전부 서버가
//      DB에서 조회해 구성한다 — 임의 주소·임의 내용 발송 불가
//   2) 발송 전 notified_at을 조건부 PATCH로 선점 — 같은 신청 건은 평생 1회만 발송
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      RESEND_API_KEY (미설정이면 발송 기능 꺼짐 — 클라이언트는 mailto 폴백),
//      RESEND_FROM (선택, 기본 noreply@gatherallaround.com — Resend에 인증된 도메인이어야 함)
// 사전 준비(1회, Supabase SQL Editor): supabase/migrations/20260901_community_app_status.sql

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

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 모임장 알림 메일 본문 — index.html에 있던 템플릿을 서버로 이관
function buildEmail(meeting, app) {
    const dateStr = meeting.meeting_date ? meeting.meeting_date.replace(/-/g, '.') : '';
    const timeStr = meeting.meeting_time || '';
    const row = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#888;white-space:nowrap;font-size:0.88rem;">${esc(k)}</td><td style="padding:6px 0;font-size:0.88rem;">${esc(v)}</td></tr>`;
    const infoRows = [
        dateStr ? row('날짜·시간', `${dateStr}${timeStr ? ' · ' + timeStr : ''}`) : '',
        meeting.location ? row('장소', meeting.location) : '',
    ].join('');
    const formData = app.form_data && typeof app.form_data === 'object' ? app.form_data : {};
    const appRows = [
        row('이름', app.applicant_name),
        row('연락처', app.applicant_phone || ''),
        ...Object.entries(formData).filter(([, v]) => v).map(([k, v]) => row(k, v)),
    ].join('');
    const subject = `[${meeting.title}] 신규 신청: ${app.applicant_name}`;
    const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#222;">
  <div style="background:#f5f5f5;padding:28px 32px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;font-size:0.8rem;color:#888;">게더 올 어라운드 커뮤니티 신청 알림</p>
    <h2 style="margin:0;font-size:1.25rem;">[${esc(meeting.title)}]<br>새로운 신청이 접수되었습니다</h2>
  </div>
  <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;">
    <p style="margin:0 0 20px;font-size:0.95rem;">안녕하세요, <b>${esc(meeting.organizer_name)}</b>님!<br>아래 신청 정보를 확인해주세요.</p>
    ${infoRows ? `<p style="margin:0 0 6px;font-size:0.8rem;font-weight:700;color:#888;letter-spacing:0.05em;">모임 정보</p><table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${infoRows}</table>` : ''}
    <p style="margin:0 0 6px;font-size:0.8rem;font-weight:700;color:#888;letter-spacing:0.05em;">신청자 정보</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${appRows}</table>
    <div style="background:#f9f9f9;border-radius:8px;padding:14px 16px;font-size:0.82rem;color:#666;line-height:1.6;">
      신청자 전체 목록과 수락·거절 관리는 <b>모임 수정 화면 → [신청자 관리] 탭</b>에서 하실 수 있습니다.
    </div>
  </div>
</div>`;
    return { subject, html };
}

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // GET: 셀프 진단 — 설정 상태만
    if (request.method === 'GET') {
        return json({
            환경변수_SUPABASE: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
            환경변수_RESEND: !!env.RESEND_API_KEY,
            발신주소: env.RESEND_FROM || 'noreply@gatherallaround.com (기본값)',
        });
    }
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    try {
        const { meeting_id, application_id } = await request.json().catch(() => ({}));
        if (!UUID_RE.test(String(meeting_id || '')) || !UUID_RE.test(String(application_id || ''))) {
            return json({ error: 'invalid ids' }, 400);
        }
        const SUPABASE_URL = env.SUPABASE_URL;
        const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'missing SUPABASE env vars' }, 500);
        // Resend 키 미설정 = 기능 꺼짐 — 클라이언트가 mailto 폴백을 쓰도록 조용히 알림
        if (!env.RESEND_API_KEY) return json({ ok: false, skipped: 'email-disabled' });
        const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

        const [mtRes, appRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/community_meetings?id=eq.${meeting_id}&select=*&limit=1`, { headers: sbHeaders }),
            fetch(`${SUPABASE_URL}/rest/v1/community_applications?id=eq.${application_id}&select=*&limit=1`, { headers: sbHeaders }),
        ]);
        if (!mtRes.ok || !appRes.ok) return json({ error: 'lookup failed' }, 502);
        const [meeting] = await mtRes.json();
        const [app] = await appRes.json();
        if (!meeting || !app || app.meeting_id !== meeting.id) return json({ error: 'not found' }, 404);
        const to = String(meeting.organizer_email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ ok: false, skipped: 'no-organizer-email' });

        // 선점: notified_at이 아직 null인 행만 — 같은 신청 건 재호출은 발송 없이 종료
        const claimTs = new Date().toISOString();
        const claimRes = await fetch(
            `${SUPABASE_URL}/rest/v1/community_applications?id=eq.${application_id}&notified_at=is.null`,
            { method: 'PATCH',
              headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify({ notified_at: claimTs }) });
        if (!claimRes.ok) {
            return json({ error: 'claim failed', detail: (await claimRes.text().catch(() => '')).slice(0, 200) }, 502);
        }
        const claimed = await claimRes.json().catch(() => []);
        if (!Array.isArray(claimed) || claimed.length === 0) return json({ ok: false, skipped: 'already-sent' });

        const { subject, html } = buildEmail(meeting, app);
        const sendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.RESEND_FROM || 'noreply@gatherallaround.com', to, subject, html }),
        });
        if (!sendRes.ok) {
            // 실패 → 내가 찍은 선점만 되돌려 다음 시도 여지를 남긴다
            await fetch(
                `${SUPABASE_URL}/rest/v1/community_applications?id=eq.${application_id}&notified_at=eq.${encodeURIComponent(claimTs)}`,
                { method: 'PATCH', headers: { ...sbHeaders, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ notified_at: null }) }).catch(() => {});
            return json({ ok: false, error: 'resend failed', status: sendRes.status,
                detail: (await sendRes.text().catch(() => '')).slice(0, 300) }, 502);
        }
        return json({ ok: true });
    } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
    }
}
