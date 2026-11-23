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

// 모임장 알림 메일 본문 — index.html에 있던 템플릿을 서버로 이관.
// 신청자 정보는 표가 아니라 질문 위·답변 아래의 세로 배치 — 모임장이 만든 질문이
// 아무리 길어도(계좌 안내 문구 등) 답변 칸이 짜부라지지 않는다.
function buildEmail(meeting, app) {
    const dateStr = meeting.meeting_date ? meeting.meeting_date.replace(/-/g, '.') : '';
    const timeStr = meeting.meeting_time || '';
    const infoRow = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#888;white-space:nowrap;font-size:0.88rem;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-size:0.88rem;">${esc(v)}</td></tr>`;
    const infoRows = [
        dateStr ? infoRow('날짜·시간', `${dateStr}${timeStr ? ' · ' + timeStr : ''}`) : '',
        meeting.location ? infoRow('장소', meeting.location) : '',
    ].join('');
    const item = (k, v) => `<div style="margin:0 0 14px;">
      <div style="font-size:0.78rem;color:#888;line-height:1.5;margin-bottom:3px;">${esc(k)}</div>
      <div style="font-size:0.95rem;font-weight:600;line-height:1.6;">${esc(v).replace(/\n/g, '<br>')}</div>
    </div>`;
    const formData = app.form_data && typeof app.form_data === 'object' ? app.form_data : {};
    const appItems = [
        item('이름', app.applicant_name),
        item('연락처', app.applicant_phone || ''),
        ...Object.entries(formData).filter(([, v]) => v).map(([k, v]) => item(k, v)),
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
    <p style="margin:0 0 10px;font-size:0.8rem;font-weight:700;color:#888;letter-spacing:0.05em;">신청자 정보</p>
    <div style="margin-bottom:16px;">${appItems}</div>
    <div style="background:#f9f9f9;border-radius:8px;padding:14px 16px;font-size:0.82rem;color:#666;line-height:1.6;">
      📎 메일에 첨부된 <b>신청서 파일(HTML)</b>을 열어 그대로 인쇄하거나 PDF로 저장할 수 있습니다.<br>
      신청자 전체 목록과 수락·거절 관리는 <b>모임 수정 화면 → [신청자 관리] 탭</b>에서 하실 수 있습니다.
    </div>
  </div>
</div>`;

    // 첨부용 신청서 — 어느 기기에서나 열리는 단일 HTML. 브라우저의 인쇄 → PDF 저장으로
    // 바로 PDF가 된다 (서버엔 브라우저·한글 폰트가 없어 PDF 직접 생성은 불가).
    const receivedAt = new Date(Date.now() + 9 * 3600e3); // KST
    const receivedStr = `${receivedAt.getUTCFullYear()}.${String(receivedAt.getUTCMonth() + 1).padStart(2, '0')}.${String(receivedAt.getUTCDate()).padStart(2, '0')} ${String(receivedAt.getUTCHours()).padStart(2, '0')}:${String(receivedAt.getUTCMinutes()).padStart(2, '0')}`;
    const sheetItem = (k, v) => `<div class="item"><div class="q">${esc(k)}</div><div class="a">${esc(v).replace(/\n/g, '<br>')}</div></div>`;
    const sheetItems = [
        sheetItem('이름', app.applicant_name),
        sheetItem('연락처', app.applicant_phone || ''),
        ...Object.entries(formData).filter(([, v]) => v).map(([k, v]) => sheetItem(k, v)),
    ].join('');
    const attachmentHtml = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>신청서 - ${esc(app.applicant_name)} (${esc(meeting.title)})</title>
<style>
  body{font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;color:#222;margin:0;background:#f0f1f3;word-break:keep-all;}
  .sheet{max-width:660px;margin:28px auto;background:#fff;border:1px solid #e3e4e6;border-radius:14px;padding:40px 44px;box-sizing:border-box;}
  .brand{font-size:0.78rem;color:#999;letter-spacing:0.06em;margin:0 0 6px;}
  h1{font-size:1.35rem;margin:0 0 4px;line-height:1.4;}
  .meta{font-size:0.82rem;color:#888;margin:0 0 24px;padding-bottom:18px;border-bottom:2px solid #222;}
  h2{font-size:0.82rem;color:#888;letter-spacing:0.05em;margin:26px 0 12px;}
  table{width:100%;border-collapse:collapse;}
  td{padding:7px 0;font-size:0.92rem;vertical-align:top;}
  td.k{color:#888;white-space:nowrap;padding-right:16px;width:1%;}
  .item{margin:0 0 16px;}
  .q{font-size:0.8rem;color:#888;line-height:1.5;margin-bottom:3px;}
  .a{font-size:0.98rem;font-weight:600;line-height:1.65;}
  .foot{margin-top:30px;padding-top:14px;border-top:1px solid #eee;font-size:0.75rem;color:#aaa;}
  @media print{ body{background:#fff} .sheet{border:none;border-radius:0;margin:0;max-width:none;padding:8mm 4mm} }
</style></head><body>
<div class="sheet">
  <p class="brand">GATHER ALL AROUND · 커뮤니티 참여 신청서</p>
  <h1>${esc(meeting.title)}</h1>
  <p class="meta">신청자 <b>${esc(app.applicant_name)}</b> · 접수 ${receivedStr}</p>
  <h2>모임 정보</h2>
  <table>
    ${dateStr ? `<tr><td class="k">날짜·시간</td><td>${esc(dateStr)}${timeStr ? ' · ' + esc(timeStr) : ''}</td></tr>` : ''}
    ${meeting.location ? `<tr><td class="k">장소</td><td>${esc(meeting.location)}</td></tr>` : ''}
    <tr><td class="k">모임장</td><td>${esc(meeting.organizer_name)}</td></tr>
  </table>
  <h2>신청 내용</h2>
  ${sheetItems}
  <p class="foot">gatherallaround.com — 이 문서는 신청 접수 시 자동 생성되었습니다. 브라우저의 인쇄 기능으로 PDF 저장이 가능합니다.</p>
</div>
</body></html>`;
    // 파일명: 한글 유지, 파일명에 못 쓰는 문자만 제거
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\n]/g, '').trim().slice(0, 40);
    const attachmentName = `신청서_${safe(app.applicant_name)}_${safe(meeting.title)}.html`;
    return { subject, html, attachmentHtml, attachmentName };
}

// UTF-8 문자열 → base64 (Resend 첨부는 base64 content)
function b64utf8(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

// ───────── 비밀번호 재설정 메일(2026-11-23) ─────────
// Supabase 기본 메일은 시간당 2통·수신 제한이 있어 일반 멤버에게 닿지 않을 수 있다 → 서비스 롤로 복구 토큰만 만들고(메일 발송 없음)
// 메일은 Resend 로 보낸다. 링크는 https://gatherallaround.com/?pwreset=<해시 토큰> — 쿼리라 인앱 브라우저가 떼지 않고,
// 토큰은 화면에서 [비밀번호 변경]을 누를 때(verifyOtp) 쓰이므로 메일 검사기가 링크를 먼저 열어도 소모되지 않는다.
// 응답은 가입 여부를 드러내지 않는다(없는 이메일도 ok). 꺼져 있거나(키·속도 제한 표 없음) 실패하면 ok:false → 화면이 Supabase 기본 메일로.
const PW_RESET_PER_IP_HOUR = 6;      // 같은 IP 에서 1시간에
const PW_RESET_PER_EMAIL_MIN = 5;    // 같은 이메일로 5분에 1통
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fromOurSite(request) {
    const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
    const ok = (h) => h === 'gatherallaround.com' || h === 'www.gatherallaround.com' || /\.(pages\.dev|gatherallaround\.com)$/.test(h) || h === 'localhost' || h === '127.0.0.1';
    const site = request.headers.get('Sec-Fetch-Site');
    if (site === 'same-origin') return true;
    const o = request.headers.get('Origin'), r = request.headers.get('Referer');
    return (!!o && ok(hostOf(o))) || (!!r && ok(hostOf(r)));
}
async function sha256Hex(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function buildPwResetEmail(link) {
    const subject = '[Gather all around] 비밀번호 재설정 안내';
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:520px;margin:0 auto;padding:24px 20px;color:#222;line-height:1.6">
<h2 style="margin:0 0 12px;font-size:1.15rem">비밀번호 재설정</h2>
<p style="margin:0 0 18px;font-size:0.95rem">게더 올 어라운드 비밀번호 재설정을 요청하셨습니다. 아래 버튼을 눌러 새 비밀번호를 정해주세요.</p>
<p style="margin:0 0 18px"><a href="${esc(link)}" style="display:inline-block;background:#2f6bff;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:0.95rem">새 비밀번호 정하기</a></p>
<p style="margin:0 0 6px;font-size:0.85rem;color:#666">버튼이 눌리지 않으면 아래 주소를 브라우저에 붙여 넣어주세요.</p>
<p style="margin:0 0 18px;font-size:0.82rem;word-break:break-all"><a href="${esc(link)}" style="color:#2f6bff">${esc(link)}</a></p>
<p style="margin:0;font-size:0.82rem;color:#888">링크는 약 1시간 동안, 한 번만 쓸 수 있습니다. 요청한 적이 없다면 이 메일은 무시하셔도 됩니다(비밀번호는 바뀌지 않습니다).</p>
</div>`;
    const text = `게더 올 어라운드 비밀번호 재설정\n\n아래 주소를 열어 새 비밀번호를 정해주세요.\n${link}\n\n링크는 약 1시간 동안, 한 번만 쓸 수 있습니다. 요청한 적이 없다면 이 메일은 무시하셔도 됩니다.`;
    return { subject, html, text };
}
export async function handlePwReset(env, body, request) {
    if (!fromOurSite(request)) return [403, { ok: false, error: 'forbidden' }];
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 200) return [400, { ok: false, error: 'bad_email' }];
    const SUPABASE_URL = env.SUPABASE_URL, SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY || !env.RESEND_API_KEY) return [200, { ok: false, skipped: 'email-disabled' }];
    if (/@band\.gatheo\.kr$/.test(email)) return [200, { ok: true }]; // 합주팀 계정은 가짜 주소 — 메일 없음(운영자가 처리)
    const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

    // 속도 제한 — auth_attempts(scope, ip, created_at). 표가 없으면 이 경로를 끄고 화면이 Supabase 기본 메일(자체 제한 있음)을 쓰게 한다.
    const ip = String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim().slice(0, 64);
    const emailKey = 'e:' + (await sha256Hex(email)).slice(0, 32); // 이메일 원문은 남기지 않는다
    const since = (min) => encodeURIComponent(new Date(Date.now() - min * 60 * 1000).toISOString());
    const count = async (key, min) => {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/auth_attempts?select=id&scope=eq.pw-reset&ip=eq.${encodeURIComponent(key)}&created_at=gte.${since(min)}&limit=20`, { headers: sbHeaders });
        if (!r.ok) return null;
        return ((await r.json().catch(() => [])) || []).length;
    };
    const [byIp, byEmail] = await Promise.all([count(ip, 60), count(emailKey, PW_RESET_PER_EMAIL_MIN)]);
    if (byIp === null || byEmail === null) return [200, { ok: false, skipped: 'no-ratelimit-table' }];
    if (byIp >= PW_RESET_PER_IP_HOUR) return [429, { ok: false, error: 'rate_limited' }];
    const mark = await fetch(`${SUPABASE_URL}/rest/v1/auth_attempts`, { method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify([{ scope: 'pw-reset', ip }, { scope: 'pw-reset', ip: emailKey }]) });
    if (!mark.ok) return [200, { ok: false, skipped: 'no-ratelimit-table' }];
    if (byEmail >= 1) return [200, { ok: true }]; // 방금 보낸 주소 — 조용히 넘어간다(메일 폭탄 방지)

    // 복구 토큰 발급(메일은 보내지 않는다) — 가입하지 않은 이메일이면 4xx → 같은 ok 응답
    const g = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: sbHeaders, body: JSON.stringify({ type: 'recovery', email }) });
    if (!g.ok) {
        const why = (await g.text().catch(() => '')).slice(0, 300);
        if (g.status === 404 || /user_not_found|user not found/i.test(why)) return [200, { ok: true }];
        return [200, { ok: false, error: 'link', status: g.status }]; // 그 밖의 실패 → 화면이 Supabase 기본 메일로
    }
    const j = await g.json().catch(() => null) || {};
    let token = j.hashed_token || (j.properties && j.properties.hashed_token) || '';
    if (!token) { try { token = new URL(j.action_link || (j.properties && j.properties.action_link) || '').searchParams.get('token') || ''; } catch (_) {} }
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(token)) return [200, { ok: false, error: 'link' }];

    const origin = request.headers.get('Origin') || '';
    const site = /^https:\/\/[a-z0-9.-]+\.pages\.dev$/.test(origin) ? origin : 'https://gatherallaround.com';
    const { subject, html, text } = buildPwResetEmail(`${site}/?pwreset=${token}`);
    const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.RESEND_FROM || 'noreply@gatherallaround.com', to: email, subject, html, text }),
    });
    if (!sendRes.ok) return [200, { ok: false, error: 'resend', status: sendRes.status }];
    return [200, { ok: true }];
}

export async function onRequest(context) {
    const { request, env } = context;
    const corsHeaders = corsFor(request.headers.get('Origin'));
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // GET: 셀프 진단 — 키 원문·개인정보 없이 설정 상태만
    if (request.method === 'GET') {
        const out = {
            환경변수_SUPABASE: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
            환경변수_RESEND: !!env.RESEND_API_KEY,
            발신주소: env.RESEND_FROM || 'noreply@gatherallaround.com (기본값)',
        };
        if (out.환경변수_SUPABASE) {
            try {
                const r = await fetch(`${env.SUPABASE_URL}/rest/v1/community_applications?select=notified_at,status&limit=1`,
                    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
                out['컬럼_20260901_SQL'] = r.ok;
                if (!r.ok) out['컬럼_오류'] = (await r.text().catch(() => '')).slice(0, 200);
            } catch (e) {
                out['컬럼_20260901_SQL'] = String(e && e.message || e);
            }
        }
        // 비밀번호 재설정 메일(pw_reset) — Resend 키 + 속도 제한 표(auth_attempts)가 있어야 우리 메일로 나간다(없으면 Supabase 기본 메일)
        if (out.환경변수_SUPABASE) {
            try {
                const r = await fetch(`${env.SUPABASE_URL}/rest/v1/auth_attempts?select=id&limit=1`,
                    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
                out['재설정메일_속도제한_표'] = r.ok;
            } catch (e) { out['재설정메일_속도제한_표'] = false; }
            out['재설정메일_발송방식'] = (out.환경변수_RESEND && out['재설정메일_속도제한_표']) ? '우리 메일(Resend)' : 'Supabase 기본 메일(시간당 2통 제한)';
        }
        return json(out);
    }
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    try {
        const reqBody = await request.json().catch(() => ({})) || {};
        if (reqBody.action === 'pw_reset') {
            const [status, out] = await handlePwReset(env, reqBody, request);
            return json(out, status);
        }
        const { meeting_id, application_id } = reqBody;
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

        const { subject, html, attachmentHtml, attachmentName } = buildEmail(meeting, app);
        const sendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: env.RESEND_FROM || 'noreply@gatherallaround.com', to, subject, html,
                // 신청서 파일 첨부 — 열면 인쇄용 양식, 브라우저 인쇄 → PDF 저장 가능
                attachments: [{ filename: attachmentName, content: b64utf8(attachmentHtml) }],
            }),
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
