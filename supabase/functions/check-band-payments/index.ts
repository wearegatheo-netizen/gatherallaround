// Supabase Edge Function: check-band-payments
// 매일 스케줄로 실행, 납부일 임박/초과 팀을 관리자에게 Web Push로 알림.
//
// Deploy:
//   supabase functions deploy check-band-payments --project-ref <PROJECT_REF> --no-verify-jwt
//
// Secrets 설정:
//   supabase secrets set PUSH_ENDPOINT=https://gatherallaround.co.kr/push --project-ref <PROJECT_REF>
//
// pg_cron 스케줄 (Supabase SQL Editor):
//   SELECT cron.schedule(
//     'check-band-payments-daily',
//     '0 0 * * *',  -- 매일 UTC 00:00 = KST 09:00
//     $$
//     SELECT net.http_post(
//       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/check-band-payments',
//       headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
//       body := '{}'::jsonb
//     );
//     $$
//   );

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function nextPaymentDate(lastPaidAt: string): Date {
  const d = new Date(lastPaidAt);
  d.setDate(d.getDate() + 28);
  return d;
}

function paymentStatus(nextDate: Date): "overdue" | "imminent" | "normal" {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((nextDate.getTime() - today.getTime()) / 86400000);
  if (diff < -7) return "overdue";
  if (diff <= 7) return "imminent";
  return "normal";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PUSH_ENDPOINT = Deno.env.get("PUSH_ENDPOINT") || "https://gatherallaround.co.kr/push";

    const headers = {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // 승인된 합주팀 목록
    const teamsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?member_type=eq.band&status=eq.approved&select=id,band_name_kr`,
      { headers }
    );
    const teams: { id: string; band_name_kr: string }[] = await teamsRes.json();
    if (!teams.length) {
      return new Response(JSON.stringify({ ok: true, msg: "no teams" }), { headers: corsHeaders });
    }

    // 각 팀의 최근 납부일 조회
    const teamIds = teams.map((t) => t.id).join(",");
    const paymentsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/band_payments?team_id=in.(${teamIds})&select=team_id,paid_at&order=paid_at.desc`,
      { headers }
    );
    const payments: { team_id: string; paid_at: string }[] = await paymentsRes.json();

    // 팀별 최신 납부일 맵
    const paymentMap: Record<string, string> = {};
    for (const p of payments) {
      if (!paymentMap[p.team_id]) paymentMap[p.team_id] = p.paid_at;
    }

    // 알림 대상 팀 필터
    const today = new Date();
    const alertTeams = teams
      .map((t) => {
        const last = paymentMap[t.id];
        if (!last) return { name: t.band_name_kr, label: "납부 이력 없음", status: "unknown" };
        const next = nextPaymentDate(last);
        const status = paymentStatus(next);
        const diff = Math.round((next.getTime() - today.getTime()) / 86400000);
        const label = diff >= 0 ? `${diff}일 후` : `${-diff}일 지남`;
        return { name: t.band_name_kr, label, status };
      })
      .filter((x) => x.status === "overdue" || x.status === "imminent" || x.status === "unknown");

    if (!alertTeams.length) {
      return new Response(JSON.stringify({ ok: true, msg: "no alerts needed" }), { headers: corsHeaders });
    }

    const title = "💰 월세 납부 알림";
    const body = alertTeams.map((a) => `${a.name}: ${a.label}`).join("\n");

    // 관리자(게더링 팀) push_subscription 조회
    const adminRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?band_name_kr=eq.게더링&push_subscription=not.is.null&select=push_subscription`,
      { headers }
    );
    const admins: { push_subscription: object }[] = await adminRes.json();

    if (!admins.length) {
      return new Response(JSON.stringify({ ok: true, msg: "no admin subscriptions" }), { headers: corsHeaders });
    }

    // 각 구독에 push 발송 (Cloudflare /push 엔드포인트 경유)
    const results = await Promise.allSettled(
      admins.map((a) =>
        fetch(PUSH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, subscription: a.push_subscription }),
        }).then((r) => r.json())
      )
    );

    return new Response(
      JSON.stringify({ ok: true, alertTeams, pushResults: results.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
