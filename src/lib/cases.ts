// Case state for the dispute inbox, kept in the tenant's store (see store/index.ts):
// Postgres for sellers when DATABASE_URL is set, memory for simulator visitors.

import { outcomeFor } from "./actions";
import { historyCases } from "./demo/history";
import { paypal } from "./paypal";
import { storeFor } from "./store";
import type { ActivityItem, CaseRecord, CaseStatus, Dispute } from "./types";
import { tenant, visitor } from "./visitor";

// The current tenant's store. A simulator starts with the demo shop's closed history
// (set REBUTTAL_SEED_HISTORY=0 to skip).
async function store() {
  const s = storeFor(tenant());
  if (visitor().mode === "mock") await s.seedCases(() => (process.env.REBUTTAL_SEED_HISTORY === "0" ? [] : historyCases()));
  return s;
}

export async function upsertFromDispute(d: Dispute): Promise<CaseRecord> {
  const s = await store();
  const existing = await s.getCase(d.dispute_id);
  const rec: CaseRecord = existing
    ? { ...existing, dispute: d, updated_at: new Date().toISOString() }
    : { id: d.dispute_id, dispute: d, status: "NEW", trace: [], updated_at: new Date().toISOString() };
  // PayPal may close a dispute outside the app (a ruling, or a dispute decided before this
  // server started); show that result instead of offering to investigate a closed case.
  if (!rec.outcome && d.dispute_outcome?.outcome_code) {
    const o = outcomeFor(d, rec.submitted?.decision);
    if (o) Object.assign(rec, { outcome: o, status: o.result });
  }
  if (existing) {
    // Only refresh what PayPal owns, so a concurrent update to the case isn't lost.
    const patch: Partial<CaseRecord> = { dispute: d, updated_at: rec.updated_at };
    if (rec.outcome !== existing.outcome) Object.assign(patch, { outcome: rec.outcome, status: rec.status });
    return (await s.patchCase(rec.id, patch)) ?? rec;
  }
  await s.putCase(rec);
  return rec;
}

export async function syncCases(): Promise<CaseRecord[]> {
  const disputes = await paypal().listDisputes();
  for (const d of disputes) await upsertFromDispute(d);
  return await listCases();
}

export async function listCases(): Promise<CaseRecord[]> {
  const all = await (await store()).listCases();
  return all.sort((a, b) => b.dispute.create_time.localeCompare(a.dispute.create_time));
}

export async function getCase(id: string): Promise<CaseRecord | undefined> {
  return (await store()).getCase(id);
}

export async function updateCase(id: string, patch: Partial<CaseRecord> & { status?: CaseStatus }): Promise<CaseRecord> {
  const next = await (await store()).patchCase(id, { ...patch, updated_at: new Date().toISOString() });
  if (!next) throw new Error(`Unknown case ${id}`);
  return next;
}

// Adds a seller-facing alert to the case; the inbox shows the newest across all cases.
export async function addActivity(id: string, text: string, tone: ActivityItem["tone"] = "info"): Promise<CaseRecord | undefined> {
  return (await store()).appendActivity(id, { at: new Date().toISOString(), text, tone }, 20);
}

export async function resetCases() {
  await storeFor(tenant()).clearCases();
}

// Manual effort per dispute (pull tracking and order details, read the messages, write
// the response), and what is left when the agent has prepared it and the seller only
// reviews. Estimates, shown as such in the inbox.
export const MANUAL_MINUTES = 45;
export const REVIEW_MINUTES = 5;

export function stats(cases: CaseRecord[]) {
  const amt = (c: CaseRecord) => Number(c.dispute.dispute_amount.value);
  const open = cases.filter((c) => !c.outcome);
  const decided = cases.filter((c) => c.outcome);
  const answered = cases.filter((c) => c.submitted);
  const auto = answered.filter((c) => c.submitted?.by === "autopilot");
  const dueSoon = open.filter((c) => {
    if (c.submitted || !c.dispute.seller_response_due_date) return false;
    return Date.parse(c.dispute.seller_response_due_date) - Date.now() <= 3 * 86_400_000;
  });
  const minutesSaved = auto.length * MANUAL_MINUTES + (answered.length - auto.length) * (MANUAL_MINUTES - REVIEW_MINUTES);
  return {
    open: open.length,
    at_risk: open.reduce((s, c) => s + amt(c), 0),
    kept: decided.reduce((s, c) => s + (c.outcome?.amount_kept ?? 0), 0),
    won: decided.filter((c) => c.outcome?.result === "WON").length,
    decided: decided.length,
    // PayPal rulings only: refunds and accepted offers aren't wins or losses.
    rulings: decided.filter((c) => c.outcome?.result === "WON" || c.outcome?.result === "LOST").length,
    answered: answered.length,
    autopilot: auto.length,
    hours_saved: Math.round((minutesSaved / 60) * 10) / 10,
    due_soon: dueSoon.length,
    due_soon_amount: dueSoon.reduce((s, c) => s + amt(c), 0),
  };
}
