import { after } from "next/server";
import { ingestDisputeEvent, runAutopilot } from "@/lib/autopilot";
import { getCase } from "@/lib/cases";
import { negotiate } from "@/lib/negotiation";
import { paypal } from "@/lib/paypal";
import { runAs, type Visitor } from "@/lib/visitor";

export const maxDuration = 300;

// PayPal calls this for CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED. A new dispute is
// investigated in the background and the seller's autopilot rules applied, so either
// PayPal already has an answer or an approval is waiting when the seller looks.
// Webhooks come from the live PayPal sandbox, whatever mode visitors have picked.
const SERVER: Visitor = { id: "server", mode: "sandbox" };

export async function POST(req: Request) {
  return runAs(SERVER, () => handle(req));
}

async function handle(req: Request) {
  const event = await req.json().catch(() => null);
  if (!event?.event_type) return Response.json({ error: "Bad payload" }, { status: 400 });
  // Ignore other event types before verifying, so an app subscribed to more events
  // (or a missing PAYPAL_WEBHOOK_ID) never makes PayPal retry events we don't use.
  if (!String(event.event_type).startsWith("CUSTOMER.DISPUTE.")) return Response.json({ ignored: true });
  const gw = paypal();
  try {
    if (!(await gw.verifyWebhook(req.headers, event))) return Response.json({ error: "Signature check failed" }, { status: 401 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (!event.resource?.dispute_id) return Response.json({ error: "No dispute_id" }, { status: 400 });

  let ingested;
  try {
    ingested = await ingestDisputeEvent(event);
  } catch (e) {
    // PayPal's "simulate event" sends a sample dispute that doesn't exist in the sandbox.
    // The signature already checked out, so accept it without investigating anything.
    console.warn(`Webhook ${event.id ?? ""} for ${event.resource.dispute_id}: dispute not readable (${e instanceof Error ? e.message : e}).`);
    return Response.json({ received: true, investigated: false }, { status: 202 });
  }
  const { case: rec, investigate } = ingested;
  if (investigate) after(() => runAs(SERVER, () => runAutopilot(rec.id)));
  // The buyer answered an offer from the negotiator: let the agent make its next move.
  else if (getCase(rec.id)?.negotiation?.status === "WAITING_FOR_BUYER") {
    after(() => runAs(SERVER, () => negotiate(rec.id).catch((e) => console.error(`negotiation ${rec.id} failed:`, e))));
  }
  return Response.json({ received: true });
}
