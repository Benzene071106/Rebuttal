import { connection } from "next/server";
import { armedFault } from "@/lib/paypal/mock";
import { paypal } from "@/lib/paypal";
import { listIncidents } from "@/lib/recovery";
import { withVisitor } from "@/lib/visitor";

// The self-healing log: PayPal calls that failed and how the agent recovered.
export const GET = withVisitor(async () => {
  await connection();
  return Response.json({ incidents: listIncidents(), armed: paypal().mode === "mock" ? armedFault() : null });
});
