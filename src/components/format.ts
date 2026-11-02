import type { CaseRecord, Decision, DisputeReason } from "@/lib/types";

export const REASON_LABEL: Record<DisputeReason, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid other way",
  CANCELED_RECURRING_BILLING: "Canceled billing",
  PROBLEM_WITH_REMITTANCE: "Remittance",
  OTHER: "Other",
};

export const DECISION_LABEL: Record<Decision, string> = { FIGHT: "Fight", OFFER: "Partial refund", REFUND: "Refund" };
export const DECISION_COLOR: Record<Decision, string> = { FIGHT: "var(--fight)", OFFER: "var(--offer)", REFUND: "var(--refund)" };

export const money = (v: number | string, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(v));

export function daysLeft(iso?: string) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function statusLabel(c: CaseRecord): string {
  switch (c.status) {
    case "NEW": return "Not analyzed";
    case "ANALYZING": return "Analyzing";
    case "READY": return "Ready to review";
    case "SUBMITTED": return c.submitted?.decision === "OFFER" ? "Offer sent" : "Evidence sent";
    case "WON": return "Won";
    case "LOST": return "Lost";
    case "SETTLED": return "Settled";
    case "REFUNDED": return "Refunded";
    case "ERROR": return "Needs attention";
  }
}

// Triage order for open disputes: money at risk, weighted by how close the response
// deadline is. PayPal decides for the buyer when the seller misses it.
export function priorityOf(c: CaseRecord): { score: number; label: "Urgent" | "Soon" | null } {
  if (c.outcome || c.submitted) return { score: -1, label: null };
  const d = daysLeft(c.dispute.seller_response_due_date);
  const amount = Number(c.dispute.dispute_amount.value);
  const weight = d === null ? 1 : d <= 3 ? 4 : d <= 7 ? 2 : 1;
  return { score: amount * weight, label: d === null ? null : d <= 3 ? "Urgent" : d <= 7 ? "Soon" : null };
}

// Splits a list into batches of at most `size` (bulk approve sends 25 per request).
export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += Math.max(1, size)) out.push(xs.slice(i, i + Math.max(1, size)));
  return out;
}
