import { z } from "zod";
import { paypal } from "@/lib/paypal";
import { armFault } from "@/lib/paypal/mock";
import { withVisitor } from "@/lib/visitor";

const Body = z.object({ kind: z.enum(["OUTAGE", "TOKEN_EXPIRED", "INSUFFICIENT_FUNDS"]).nullable() });

// Simulator only: make this visitor's next PayPal write fail, to watch the agent recover.
export const POST = withVisitor(async (req: Request) => {
  if (paypal().mode !== "mock") return Response.json({ error: "Fault injection is only available in the Simulator." }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Unknown fault." }, { status: 400 });
  armFault(parsed.data.kind);
  return Response.json({ armed: parsed.data.kind });
});
