import crypto from "node:crypto";
import { after } from "next/server";
import { ingestDisputeEvent, runAutopilot } from "@/lib/autopilot";
import { paypal } from "@/lib/paypal";
import { runAs, visitor, withVisitor } from "@/lib/visitor";

export const maxDuration = 300;

// Judge mode: a simulated buyer files a dispute, and the simulator delivers the same
// CUSTOMER.DISPUTE.CREATED webhook PayPal would, through the same autopilot code path.
export const POST = withVisitor(async () => {
  try {
    const d = await paypal().fileTestDispute();
    const event = {
      id: `WH-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource_type: "dispute",
      summary: `A new dispute opened with Case # ${d.dispute_id}`,
      resource: d,
    };
    const { case: rec, investigate } = await ingestDisputeEvent(event);
    const v = { ...visitor() };
    if (investigate) after(() => runAs(v, () => runAutopilot(rec.id)));
    return Response.json(rec);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
});
