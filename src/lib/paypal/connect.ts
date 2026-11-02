// Connecting a seller's own PayPal REST app: check the credentials, check the app may
// read disputes, and register the dispute webhook that drives autopilot.

import { apiBase, type PayPalEnv } from "./toolkit";

export const WEBHOOK_EVENTS = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"];

export class ConnectError extends Error {}

async function token(env: PayPalEnv, clientId: string, secret: string): Promise<string> {
  const res = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new ConnectError(`PayPal rejected these credentials. Check they are the ${env === "live" ? "Live" : "Sandbox"} Client ID and Secret of the same app.`);
  if (!res.ok) throw new ConnectError(`PayPal sign-in failed (${res.status}). Try again in a minute.`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function call(env: PayPalEnv, bearer: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { ok: res.ok, status: res.status, json };
}

// The public https address PayPal can deliver webhooks to, or null when running locally.
export function publicBaseUrl(): string | null {
  const url = process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL;
  return url && url.startsWith("https://") ? url.replace(/\/$/, "") : null;
}

export type ConnectResult = { webhook_id: string | null; warnings: string[] };

export async function connectPayPal(sellerId: string, env: PayPalEnv, clientId: string, secret: string): Promise<ConnectResult> {
  const bearer = await token(env, clientId, secret);
  const warnings: string[] = [];

  const disputes = await call(env, bearer, "GET", "/v1/customer/disputes?page_size=1");
  if (disputes.status === 401 || disputes.status === 403) {
    throw new ConnectError("This PayPal app isn't allowed to read disputes. In the PayPal developer dashboard, open the app and turn on the Disputes feature, then connect again.");
  }
  if (!disputes.ok) warnings.push(`PayPal didn't list disputes (${disputes.status}); Rebuttal will retry when you open the inbox.`);

  const base = publicBaseUrl();
  if (!base) {
    warnings.push("Webhooks need a public https address (set APP_URL), so autopilot only runs when you open the inbox.");
    return { webhook_id: null, warnings };
  }
  const url = `${base}/api/webhooks/paypal/${sellerId}`;
  const created = await call(env, bearer, "POST", "/v1/notifications/webhooks", { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) });
  if (created.ok) return { webhook_id: created.json?.id ?? null, warnings };
  // Connecting again: PayPal already has this URL, so reuse that webhook.
  if (created.json?.name === "WEBHOOK_URL_ALREADY_EXISTS") {
    const list = await call(env, bearer, "GET", "/v1/notifications/webhooks");
    const hit = (list.json?.webhooks ?? []).find((w: { url: string }) => w.url === url);
    if (hit) return { webhook_id: hit.id, warnings };
  }
  if (created.json?.name === "WEBHOOK_NUMBER_LIMIT_EXCEEDED") {
    warnings.push("This PayPal app already has the maximum number of webhooks. Remove an unused one in the developer dashboard and connect again to turn on autopilot.");
  } else {
    warnings.push(`PayPal didn't register the dispute webhook (${created.status}${created.json?.name ? ` ${created.json.name}` : ""}), so autopilot only runs when you open the inbox.`);
  }
  return { webhook_id: null, warnings };
}

// Removes Rebuttal's webhook from the seller's PayPal app. Best effort: the seller may
// have already deleted the app or rotated its secret.
export async function disconnectPayPal(env: PayPalEnv, clientId: string, secret: string, webhookId: string | null) {
  if (!webhookId) return;
  try {
    const bearer = await token(env, clientId, secret);
    await call(env, bearer, "DELETE", `/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`);
  } catch (e) {
    console.warn("Could not remove the PayPal webhook:", e instanceof Error ? e.message : e);
  }
}
