// Supabase Edge Function: verify-meeting-password
// 커뮤니티 모임의 "주최자 비밀번호"를 서버에서 검증한다.
// 목적: password_hash/password_salt 를 클라이언트로 내려보내지 않고(오프라인 브루트포스 방지)
//       서버(service role)에서만 대조.
//
// 요청:  POST { meetingId: string, password: string }
// 응답:  { ok: boolean }
//
// Deploy:
//   supabase functions deploy verify-meeting-password --project-ref <PROJECT_REF> --no-verify-jwt
//   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Edge 런타임 기본 제공)
//
// 배포 후 후속 정리(런북 참고): 클라이언트 community 목록 SELECT 에서
//   password_hash/password_salt 컬럼 제거 + 클라 해시 비교 폴백 제거.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));
    const meetingId = typeof body.meetingId === "string" ? body.meetingId : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!meetingId || !password) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/community_meetings?id=eq.${encodeURIComponent(meetingId)}&select=password_hash,password_salt`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const rows = await res.json();
    const row = Array.isArray(rows) && rows[0];
    let ok = false;
    if (row && row.password_hash && row.password_salt) {
      const hash = await sha256Hex(password + row.password_salt);
      ok = timingSafeEqualHex(hash, row.password_hash);
    }
    return new Response(JSON.stringify({ ok }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
