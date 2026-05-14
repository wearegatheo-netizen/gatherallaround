// Supabase Edge Function: verify-community-admin
// Compares a submitted password against the server-side COMMUNITY_ADMIN_PW secret.
// Returning only { ok: boolean } prevents the master password from ever being exposed in client code.
//
// Deploy:
//   supabase functions deploy verify-community-admin --no-verify-jwt
//   supabase secrets set COMMUNITY_ADMIN_PW=<your-master-password>

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const body = await req.json().catch(() => ({}));
    const password = typeof body.password === "string" ? body.password : "";
    const ok = password.length > 0 && password === ADMIN_PW;
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
