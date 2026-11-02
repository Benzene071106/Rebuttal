// Executes the seller-approved decision against PayPal and records the outcome.

import { getCase, updateCase } from "./cases";
import { paypal } from "./paypal";
import { withRecovery } from "./recovery";
import type { CaseRecord, Decision, Dispute, EvidenceType } from "./types";

export type Approval = {
  decision: Decision;
  response: string;
  offer_amount?: number;
  offer_type?: "REFUND" | "REFUND_WITH_RETURN";
  by?: "seller" | "autopilot";
};

export async function approve(caseId: string, a: Approval): Promise<CaseRecord> {
  const c = await getCase(caseId);
  if (!c) throw new Error(`Unknown case ${caseId}`);
  if (c.submitted) throw new Error("A response was already sent for this dispute.");
  const gw = paypal();
  const r = c.recommendation;
  const currency = c.dispute.dispute_amount.currency_code;
  const response = a.response.trim().slice(0, 2000);
  if (!response) throw new Error("The response to PayPal is empty.");

  if (a.decision === "FIGHT") {
    const types = [...new Set<EvidenceType>(r?.evidence.map((e) => e.type) ?? ["OTHER"])];
    const tracking = r?.tracking_number ? { carrier: r.tracking_carrier, tracking_number: r.tracking_number } : undefined;
    if (tracking && !types.includes("PROOF_OF_FULFILLMENT")) types.unshift("PROOF_OF_FULFILLMENT");
    const txnId = c.dispute.disputed_transactions[0]?.seller_transaction_id;
    if (tracking && txnId) {
      // Best effort: the evidence below carries the tracking too, so a failure here
      // shouldn't block the response.
      try {
        const invoice = c.dispute.disputed_transactions[0]?.invoice_number;
        const res = await gw.addTracking(txnId, tracking, invoice ? await gw.orderIdForInvoice(invoice) : null);
        if (res === "added") await note(caseId, `Added ${tracking.carrier} tracking ${tracking.tracking_number} to the PayPal transaction.`);
      } catch (e) {
        await note(caseId, `Could not add tracking to the PayPal transaction: ${e instanceof Error ? e.message : e}`, "error");
      }
    }
    await withRecovery(c, "FIGHT", Number(c.dispute.dispute_amount.value), () => gw.provideEvidence(caseId, { notes: response, evidence_types: types, tracking }));
  } else if (a.decision === "OFFER") {
    const amount = Number(a.offer_amount);
    const max = Number(c.dispute.dispute_amount.value);
    if (!(amount > 0 && amount < max)) throw new Error(`Offer must be between 0 and ${max}.`);
    await withRecovery(c, "OFFER", amount, () => gw.makeOffer(caseId, { amount: amount.toFixed(2), currency, type: a.offer_type ?? "REFUND", note: response }));
  } else {
    await withRecovery(c, "REFUND", Number(c.dispute.dispute_amount.value), () => gw.acceptClaim(caseId, response));
  }

  const dispute = await gw.getDispute(caseId);
  return await updateCase(caseId, {
    dispute,
    status: a.decision === "REFUND" ? "REFUNDED" : "SUBMITTED",
    submitted: { decision: a.decision, at: new Date().toISOString(), response, offer_amount: a.offer_amount, by: a.by ?? "seller" },
    outcome: a.decision === "REFUND" ? outcomeFor(dispute, "REFUND") : undefined,
  });
}

async function note(caseId: string, summary: string, kind: "note" | "error" = "note") {
  const c = await getCase(caseId);
  if (c) await updateCase(caseId, { trace: [...c.trace, { at: new Date().toISOString(), kind, summary }] });
}

// Sandbox only: ask PayPal to rule on the dispute so the full lifecycle can be shown.
export async function simulateRuling(caseId: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR"): Promise<CaseRecord> {
  const c = await getCase(caseId);
  if (!c?.submitted) throw new Error("Send a response before simulating PayPal's ruling.");
  await paypal().simulateRuling(caseId, outcome);
  const dispute = await paypal().getDispute(caseId);
  const o = outcomeFor(dispute, c.submitted.decision);
  return await updateCase(caseId, { dispute, outcome: o, status: o?.result ?? c.status });
}

export function outcomeFor(d: Dispute, decision?: Decision): CaseRecord["outcome"] {
  const code = d.dispute_outcome?.outcome_code;
  if (!code) return undefined;
  const total = Number(d.dispute_amount.value);
  const refunded = Number(d.dispute_outcome?.amount_refunded?.value ?? 0);
  const at = new Date().toISOString();
  if (code === "RESOLVED_SELLER_FAVOUR") return { result: "WON", amount_kept: total, amount_lost: 0, at };
  if (code === "RESOLVED_WITH_PAYOUT") return { result: "SETTLED", amount_kept: total - refunded, amount_lost: refunded, at };
  if (decision === "REFUND") return { result: "REFUNDED", amount_kept: total - (refunded || total), amount_lost: refunded || total, at };
  return { result: "LOST", amount_kept: total - refunded, amount_lost: refunded || total, at };
}
