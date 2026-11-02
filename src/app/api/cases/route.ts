import { connection } from "next/server";
import { stats, syncCases } from "@/lib/cases";
import { paypal, sandboxAvailable } from "@/lib/paypal";
import { accountsEnabled } from "@/lib/auth/sellers";
import { visitor, viewOnly, withVisitor } from "@/lib/visitor";

// Always read live dispute state; never prerender.
export const GET = withVisitor(async () => {
  await connection();
  try {
    const cases = await syncCases();
    const seller = visitor().seller;
    const account = seller ? { email: seller.email, paypal_env: seller.paypal?.env ?? null } : null;
    return Response.json({ mode: paypal().mode, sandboxAvailable: sandboxAvailable(), viewOnly: viewOnly(), accounts: accountsEnabled(), account, cases, stats: stats(cases) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});
