import { connection } from "next/server";
import { stats, syncCases } from "@/lib/cases";
import { networkFor } from "@/lib/network";
import { paypal, sandboxAvailable } from "@/lib/paypal";
import { accountsEnabled } from "@/lib/auth/sellers";
import { visitor, viewOnly, withVisitor } from "@/lib/visitor";

// Always read live dispute state; never prerender.
export const GET = withVisitor(async () => {
  await connection();
  try {
    const cases = await syncCases();
    // Open disputes from buyers other Rebuttal shops have reported: case id -> number of shops.
    const network: Record<string, number> = {};
    for (const c of cases) {
      if (c.history || c.outcome) continue;
      const n = (await networkFor(c.dispute.disputed_transactions[0]?.buyer?.email)).other_shops;
      if (n) network[c.id] = n;
    }
    const seller = visitor().seller;
    const account = seller ? { email: seller.email, paypal_env: seller.paypal?.env ?? null } : null;
    return Response.json({ mode: paypal().mode, sandboxAvailable: sandboxAvailable(), viewOnly: viewOnly(), accounts: accountsEnabled(), account, cases, stats: stats(cases), network });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});
