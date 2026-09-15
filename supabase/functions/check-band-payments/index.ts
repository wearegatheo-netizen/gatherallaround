// Supabase Edge Function: check-band-payments
// 매일 스케줄로 실행, 납부일 임박/초과 팀을 관리자에게 Web Push로 알림.
//
// 납부일 계산은 회차 모델(index.html bandCycle* · functions/send-reminders.js 와 동일)을 따른다:
//   시작일_n = band_start_date + 28n, 입금일_n = 시작일_n − 7 (n≥1). 해당 회차 납부 기록이 있으면 정상.
//   band_start_date 가 없는 팀은 예전 방식(마지막 납부일 + 28일)으로 폴백.
// 관리자 팀(게더링, 로그인 ID wearegatheo)과 사용 종료(band_ended_at) 팀은 제외.
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

const CYCLE_DAYS = 28;
const DAY_MS = 86400000;
const GATHEO_ADMIN_BAND_ID = "wearegatheo";
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd) + n * DAY_MS).toISOString().slice(0, 10);
const cycleStart = (start: string, n: number) => addDays(start, CYCLE_DAYS * n);
const cycleDue = (start: string, n: number) => (n <= 0 ? start : addDays(start, CYCLE_DAYS * n - 7));
const nextCycle = (start: string, today: string) => {
  const days = Math.round((Date.parse(today) - Date.parse(start)) / DAY_MS);
  return days < 0 ? 0 : Math.floor(days / CYCLE_DAYS) + 1;
};
const inferCycle = (start: string, paidAt: string) =>
  Math.max(0, Math.round((Date.parse(paidAt) - Date.parse(start)) / DAY_MS / CYCLE_DAYS));
const diffDays = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY_MS);

type Team = { id: string; band_name_kr: string; band_start_date: string | null; instruments: string | null; email: string | null };
type Payment = { team_id: string; paid_at: string; cycle_no: number | null };

function isAdminBand(t: Team): boolean {
  const loginId = String(t.instruments || "").trim().toLowerCase();
  const emailId = String(t.email || "").trim().toLowerCase().split("@")[0];
  return loginId === GATHEO_ADMIN_BAND_ID || emailId === GATHEO_ADMIN_BAND_ID;
}

// 팀별 알림 판정 — status 와 표시 라벨(입금일까지 남은/지난 일수)
function judge(t: Team, payments: Payment[], today: string): { status: "overdue" | "imminent" | "normal" | "unknown"; label: string } {
  const mine = payments.filter((p) => p.team_id === t.id && p.paid_at);
  if (t.band_start_date) {
    const n = nextCycle(t.band_start_date, today);
    if (n < 1) return { status: "normal", label: "시작 전" };
    const paid = mine.some((p) => (Number.isInteger(p.cycle_no) ? p.cycle_no : inferCycle(t.band_start_date!, p.paid_at)) === n);
    if (paid) return { status: "normal", label: `${n}차 납부 완료` };
    const diff = diffDays(cycleDue(t.band_start_date, n), today);
    const label = diff >= 0 ? `${n}차 입금일 ${diff}일 후` : `${n}차 입금일 ${-diff}일 지남`;
    return { status: diff < 0 ? "overdue" : diff <= 7 ? "imminent" : "normal", label };
  }
  // 폴백: 시작일 미설정 팀은 마지막 납부일 + 28일
  const last = mine.map((p) => p.paid_at).sort().pop();
  if (!last) return { status: "unknown", label: "납부 이력 없음 (시작일 미설정)" };
  const diff = diffDays(addDays(last, CYCLE_DAYS), today);
  const label = diff >= 0 ? `${diff}일 후` : `${-diff}일 지남`;
  return { status: diff < -7 ? "overdue" : diff <= 7 ? "imminent" : "normal", label };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 호출 인증: CRON_SECRET 이 설정돼 있으면 X-Cron-Secret 헤더가 일치해야 실행
  // (pg_cron http_post 의 headers 에 동일 값을 넣는다). 미설정 시 하위호환 통과.
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
      `${SUPABASE_URL}/rest/v1/profiles?member_type=eq.band&status=eq.approved&band_ended_at=is.null&select=id,band_name_kr,band_start_date,instruments,email`,
      { headers }
    );
    const teams: Team[] = ((await teamsRes.json()) as Team[]).filter((t) => !isAdminBand(t));
    if (!teams.length) {
      return new Response(JSON.stringify({ ok: true, msg: "no teams" }), { headers: corsHeaders });
    }

    // 각 팀의 납부 기록 조회 (회차 번호 포함)
    const teamIds = teams.map((t) => t.id).join(",");
    const paymentsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/band_payments?team_id=in.(${teamIds})&select=team_id,paid_at,cycle_no&order=paid_at.desc`,
      { headers }
    );
    const payments: Payment[] = await paymentsRes.json();

    // 알림 대상 팀 필터 (KST 기준 오늘)
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const alertTeams = teams
      .map((t) => ({ name: t.band_name_kr, ...judge(t, payments, today) }))
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

    // 응답에 팀명/납부상태(alertTeams)를 노출하지 않는다 — 개수만 반환.
    return new Response(
      JSON.stringify({ ok: true, alerts: alertTeams.length, pushResults: results.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
