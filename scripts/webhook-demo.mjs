// Live PayPal sandbox webhook -> autopilot, for the demo. Never prints credentials.
//
//   node scripts/webhook-demo.mjs setup https://<your-host>   registers the dispute webhook (or finds it) and prints its ID
//   node scripts/webhook-demo.mjs status                      lists the webhook and the latest dispute events PayPal sent
//   node scripts/webhook-demo.mjs resend <event-id>           asks PayPal to send a real past event again
//   node scripts/webhook-demo.mjs ping                        sends PayPal's signed sample event (checks the signature path)
//
// The real run: seed an order (npm run seed:sandbox), log in to sandbox.paypal.com as the
// sandbox buyer and report a problem with that payment. PayPal posts
// CUSTOMER.DISPUTE.CREATED to /api/webhooks/paypal, the server verifies the signature,
// the agent investigates and the seller's autopilot rules decide. The result shows under
// "Live PayPal sandbox" as an alert. New sandbox disputes can take a while to reach the
// API; "resend" replays a real event if you need to show it again.

const BASE = "https://api-m.sandbox.paypal.com";
const EVENTS = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"];

async function api(method, path, body) {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  api.token ??= (
    await (
      await fetch(`${BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      })
    ).json()
  ).access_token;
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${json.message ?? text.slice(0, 200)}`);
  return json;
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "setup") {
    if (!arg?.startsWith("https://")) throw new Error("Pass your public https host, e.g. https://rebuttal-6j9a.onrender.com");
    const url = `${arg.replace(/\/$/, "")}/api/webhooks/paypal`;
    const { webhooks = [] } = await api("GET", "/v1/notifications/webhooks");
    const found = webhooks.find((w) => w.url === url) ?? (await api("POST", "/v1/notifications/webhooks", { url, event_types: EVENTS.map((name) => ({ name })) }));
    console.log(`Webhook ${found.id} -> ${url}`);
    console.log(`Set PAYPAL_WEBHOOK_ID=${found.id} on the server (Render: Environment), then redeploy.`);
  } else if (cmd === "status") {
    const { webhooks = [] } = await api("GET", "/v1/notifications/webhooks");
    if (!webhooks.length) console.log("No webhook registered. Run: node scripts/webhook-demo.mjs setup https://<your-host>");
    for (const w of webhooks) console.log(`Webhook ${w.id} -> ${w.url} [${w.event_types.map((e) => e.name).join(", ")}]`);
    const { events = [] } = await api("GET", "/v1/notifications/webhooks-events?page_size=10");
    const disputes = events.filter((e) => e.event_type.startsWith("CUSTOMER.DISPUTE."));
    if (!disputes.length) console.log("No dispute events yet. File a dispute as the sandbox buyer.");
    for (const e of disputes) console.log(`${e.create_time}  ${e.id}  ${e.event_type}  ${e.resource?.dispute_id ?? ""}  ${e.status ?? ""}`);
  } else if (cmd === "resend") {
    if (!arg) throw new Error("Pass an event id from `status`.");
    await api("POST", `/v1/notifications/webhooks-events/${arg}/resend`, {});
    console.log(`PayPal is sending ${arg} again.`);
  } else if (cmd === "ping") {
    const { webhooks = [] } = await api("GET", "/v1/notifications/webhooks");
    if (!webhooks[0]) throw new Error("No webhook registered; run setup first.");
    await api("POST", "/v1/notifications/simulate-event", { webhook_id: webhooks[0].id, event_type: "CUSTOMER.DISPUTE.CREATED" });
    console.log("PayPal sent its signed sample event. The server answers 202 (sample dispute, nothing to investigate) when the signature checks out.");
  } else {
    console.log("Usage: node scripts/webhook-demo.mjs setup <https://host> | status | resend <event-id> | ping");
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
