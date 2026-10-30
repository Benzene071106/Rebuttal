import { resetCases } from "@/lib/cases";
import { paypal } from "@/lib/paypal";
import { resetMock } from "@/lib/paypal/mock";
import { resetShield } from "@/lib/shield";
import { withVisitor } from "@/lib/visitor";

// Resets this visitor's simulator only; other visitors keep theirs.
export const POST = withVisitor(async () => {
  if (paypal().mode !== "mock") return Response.json({ error: "Reset is only available in the Simulator." }, { status: 400 });
  resetMock();
  resetCases();
  resetShield();
  return Response.json({ ok: true });
});
