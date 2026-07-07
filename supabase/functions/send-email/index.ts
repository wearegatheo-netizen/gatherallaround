// Supabase Edge Function: send-email
// Proxies email send requests to the Resend API so the API key stays on the server.
//
// 보안 하드닝(2026-07-07) — 적용: (1)발신자 고정 (2)입력 검증 (3)오리진 제한
//   - body.from 무시(발신자 스푸핑 차단), 항상 서버 FROM 사용
//   - 수신자 이메일 형식·개수, 제목/본문 길이 검증
//   - CORS 를 사이트 오리진으로 축소
//
// Deploy:
//   supabase functions deploy send-email --project-ref <PROJECT_REF> --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=re_xxx --project-ref <PROJECT_REF>
//   supabase secrets set RESEND_FROM_EMAIL=noreply@gatherallaround.com --project-ref <PROJECT_REF>

const ALLOWED_ORIGINS = [
  "https://gatherallaround.co.kr",
  "https://www.gatherallaround.co.kr",
];
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const h = new URL(origin).hostname;
    return h.endsWith(".pages.dev") || h.endsWith(".gatherallaround.co.kr");
  } catch {
    return false;
  }
}
function corsFor(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? (origin as string) : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 5;
const MAX_SUBJECT = 200;
const MAX_BODY = 200_000; // ~200KB

function normalizeRecipients(to: unknown): string[] | null {
  const list = Array.isArray(to) ? to : [to];
  if (list.length === 0 || list.length > MAX_RECIPIENTS) return null;
  const out: string[] = [];
  for (const addr of list) {
    if (typeof addr !== "string" || !EMAIL_RE.test(addr)) return null;
    out.push(addr);
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = corsFor(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY secret not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { subject, html, text } = body;

    // (1) 발신자는 서버가 고정 — 클라이언트가 지정하는 body.from 은 무시(스푸핑 방지)
    const from = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@gatherallaround.com";

    // (2) 입력 검증
    const recipients = normalizeRecipients(body.to);
    if (!recipients) {
      return new Response(JSON.stringify({ error: "Invalid or too many recipients" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof subject !== "string" || !subject || subject.length > MAX_SUBJECT) {
      return new Response(JSON.stringify({ error: "Invalid subject" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!html && !text) {
      return new Response(JSON.stringify({ error: "Missing html/text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((html && String(html).length > MAX_BODY) || (text && String(text).length > MAX_BODY)) {
      return new Response(JSON.stringify({ error: "Body too large" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: Record<string, unknown> = { from, to: recipients, subject };
    if (html) payload.html = html;
    if (text) payload.text = text;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
