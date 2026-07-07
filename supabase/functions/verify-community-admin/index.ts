// Supabase Edge Function: verify-community-admin
// Compares a submitted password against the server-side COMMUNITY_ADMIN_PW secret.
// Returning only { ok: boolean } prevents the master password from ever being exposed in client code.
//
// 보안 하드닝(2026-07-07):
//   - 상수시간 비교(timingSafeEqual)로 타이밍 사이드채널 완화
//   - IP별 시도 횟수 제한(브루트포스 완화): auth_attempts 테이블에 기록/집계
//     (마이그레이션 20260707_backend_hardening.sql 의 auth_attempts 필요)
//
// Deploy:
//   supabase functions deploy verify-community-admin --no-verify-jwt
//   supabase secrets set COMMUNITY_ADMIN_PW=<your-master-password>

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 10;          // 창(WINDOW) 내 최대 시도
const WINDOW_MINUTES = 10;        // 집계 창(분)

// 길이/내용 노출을 줄이는 상수시간 비교(타이밍 사이드채널 완화).
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}

// auth_attempts 로 최근 실패/시도 수를 세고 기록. 테이블/권한 문제 시 조용히 통과(가용성 우선).
async function rateLimited(ip: string): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return false;
    const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
    const scope = "community-master";
    const countRes = await fetch(
      `${url}/rest/v1/auth_attempts?scope=eq.${scope}&ip=eq.${encodeURIComponent(ip)}&created_at=gte.${since}&select=id`,
      { headers: { ...h, Prefer: "count=exact" } },
    );
    const range = countRes.headers.get("content-range") || "*/0";
    const total = parseInt(range.split("/")[1] || "0", 10);
    // 이번 시도 기록(성공/실패 무관하게 시도 자체를 기록)
    await fetch(`${url}/rest/v1/auth_attempts`, {
      method: "POST", headers: h, body: JSON.stringify({ scope, ip }),
    });
    return total >= MAX_ATTEMPTS;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
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
    const ADMIN_PW = Deno.env.get("COMMUNITY_ADMIN_PW");
    if (!ADMIN_PW) {
      return new Response(JSON.stringify({ error: "COMMUNITY_ADMIN_PW secret not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (await rateLimited(clientIp(req))) {
      return new Response(JSON.stringify({ ok: false, error: "too many attempts" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const password = typeof body.password === "string" ? body.password : "";
    const ok = password.length > 0 && timingSafeEqual(password, ADMIN_PW);
    return new Response(JSON.stringify({ ok }), {
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
