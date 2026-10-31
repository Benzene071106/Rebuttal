// Health check for Render and uptime monitors: no PayPal, model or disk calls, so it
// answers in milliseconds and a ping never spends API quota.
const body = () => Response.json({ ok: true, service: "rebuttal" }, { headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return body();
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
