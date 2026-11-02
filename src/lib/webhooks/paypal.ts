// Handles a PayPal dispute webhook for one account: the shared demo sandbox, or one
// seller (each seller's PayPal app delivers to /api/webhooks/paypal/<seller id>).
//
// PayPal retries a delivery until it gets a 2xx and may deliver an event twice, so each
// event id is handled once per account (store.claimEvent).

import { after } from "next/server";
import { ingestDisputeEvent, runAutopilot } from "../autopilot";
import { getCase } from "../cases";
import { negotiate } from "../negotiation";
import { paypal } from "../paypal";
import { storeFor } from "../store";
import { runAs, tenant, type Visitor } from "../visitor";

export async function handlePayPalWebhook(req: Request, as: Visitor): Promise<Response> {
  return runAs(as, () => handle(req, as));
}

async function handle(req: Request, as: Visitor): Promise<Response> {
  const event = await req.json().catch(() => null);
  if (!event?.event_type) return Response.json({ error: "Bad payload" }, { status: 400 });
  const gw = paypal();
  try {
    if (!(await gw.verifyWebhook(req.headers, event))) return Response.json({ error: "Signature check failed" }, { status: 401 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (!String(event.event_type).startsWith("CUSTOMER.DISPUTE.")) return Response.json({ ignored: true });
  if (!event.resource?.dispute_id) return Response.json({ error: "No dispute_id" }, { status: 400 });

  const store = storeFor(tenant());
  const eventId = typeof event.id === "string" ? event.id : null;
  if (eventId && !(await store.claimEvent(eventId))) return Response.json({ duplicate: true });

  try {
    const { case: rec, investigate } = await ingestDisputeEvent(event);
    if (investigate) after(() => runAs(as, () => runAutopilot(rec.id)));
    // The buyer answered an offer from the negotiator: let the agent make its next move.
    else if ((await getCase(rec.id))?.negotiation?.status === "WAITING_FOR_BUYER") {
      after(() => runAs(as, () => negotiate(rec.id).catch((e) => console.error(`negotiation ${rec.id} failed:`, e))));
    }
    return Response.json({ received: true });
  } catch (e) {
    // Let PayPal's retry try again.
    if (eventId) await store.releaseEvent(eventId).catch(() => {});
    console.error("webhook handling failed:", e);
    return Response.json({ error: "Could not process the event" }, { status: 500 });
  }
}
