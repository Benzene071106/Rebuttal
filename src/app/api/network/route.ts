import { connection } from "next/server";
import { listCases, syncCases } from "@/lib/cases";
import { PENDING_ORDERS } from "@/lib/demo/orders";
import { buyerHash, listNetwork, networkFor } from "@/lib/network";
import { paypal } from "@/lib/paypal";
import { withVisitor } from "@/lib/visitor";

// The Rebuttal network for this shop: GET lists reported accounts (named only where the
// shop has its own record of the buyer); ?case=<id> returns the match for one dispute.
export const GET = withVisitor(async (req: Request) => {
  await connection();
  await syncCases();
  const caseId = new URL(req.url).searchParams.get("case");
  if (caseId) {
    const c = (await listCases()).find((x) => x.id === caseId);
    const m = await networkFor(c?.dispute.disputed_transactions[0]?.buyer?.email);
    return Response.json({ other_shops: m.other_shops, reports: m.reports.map(({ buyer_hash: _h, ...r }) => r) });
  }
  const known = new Map<string, { email: string; name: string }>();
  for (const c of await listCases()) {
    const b = c.dispute.disputed_transactions[0]?.buyer;
    if (b?.email) known.set(b.email.toLowerCase(), { email: b.email.toLowerCase(), name: b.name ?? b.email });
  }
  // Paid orders waiting to ship (simulator only for now).
  const orders = paypal().mode === "mock" ? PENDING_ORDERS : [];
  for (const o of orders) known.set(o.buyer.email, { email: o.buyer.email, name: o.buyer.name });
  const net = await listNetwork([...known.values()]);
  const ordering = new Map(orders.map((o) => [buyerHash(o.buyer.email), o.key]));
  return Response.json({ ...net, accounts: net.accounts.map((a) => ({ ...a, pending_order: ordering.get(a.buyer_hash) ?? null })) });
});
