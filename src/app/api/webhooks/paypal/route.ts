import { after } from "next/server";
import { ingestDisputeEvent, runAutopilot } from "@/lib/autopilot";
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
  const gw = paypal();
  try {
    if (!(await gw.verifyWebhook(req.headers, event))) return Response.json({ error: "Signature check failed" }, { status: 401 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (!String(event.event_type).startsWith("CUSTOMER.DISPUTE.")) return Response.json({ ignored: true });
  if (!event.resource?.dispute_id) return Response.json({ error: "No dispute_id" }, { status: 400 });

  const { case: rec, investigate } = await ingestDisputeEvent(event);
  if (investigate) after(() => runAs(SERVER, () => runAutopilot(rec.id)));
  return Response.json({ received: true });
}
