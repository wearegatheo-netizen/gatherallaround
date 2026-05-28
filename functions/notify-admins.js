// Cloudflare Pages Function: /notify-admins
// 비인증 사용자가 관리자에게 푸시 알림을 보낼 때 사용 (RLS 우회).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ /push가 사용하는 VAPID_*)

export async function onRequest(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    const { request, env } = context;
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    try {
        const { title, body } = await request.json();
        if (!title || !body) {
            return new Response(JSON.stringify({ error: 'title and body required' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const SUPABASE_URL = env.SUPABASE_URL;
        const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!SUPABASE_URL || !SERVICE_KEY) {
            return new Response(JSON.stringify({ error: 'missing SUPABASE env vars' }), {
                status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const roleFilter = encodeURIComponent('in.("운영 총괄","총괄","세션장")');
        const url = `${SUPABASE_URL}/rest/v1/profiles?role=${roleFilter}&push_subscription=not.is.null&select=push_subscription`;
        const sbRes = await fetch(url, {
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
            },
        });
        const profs = await sbRes.json();
        const subs = (profs || []).map(p => p.push_subscription).filter(Boolean);

        const origin = new URL(request.url).origin;
        const results = await Promise.allSettled(subs.map(sub =>
            fetch(`${origin}/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, body, subscription: sub }),
            }).then(r => r.json())
        ));

        return new Response(JSON.stringify({ ok: true, sent: results.length }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}
