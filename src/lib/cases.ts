// Case state for the dispute inbox. Kept in memory and mirrored to data/cases.json
// so a restart of the dev server keeps the demo history.

import fs from "node:fs";
import path from "node:path";
import { outcomeFor } from "./actions";
import { historyCases } from "./demo/history";
import { paypal } from "./paypal";
import type { ActivityItem, CaseRecord, CaseStatus, Dispute } from "./types";
import { lruGet, visitor } from "./visitor";

const FILE = path.join(process.cwd(), "data", "cases.json");
// Simulator cases belong to each visitor, like the simulated disputes behind them; the
// live sandbox is one real PayPal account, so its cases are shared.
const g = globalThis as unknown as { __rebuttalCases?: { sandbox?: Map<string, CaseRecord>; mock: Map<string, Map<string, CaseRecord>> } };

function load(): Map<string, CaseRecord> {
  g.__rebuttalCases ??= { mock: new Map() };
  const store = g.__rebuttalCases;
  // Mock disputes live in memory only, so a persisted mock case file would point at
  // disputes that no longer exist after a restart.
  // Each simulator starts with the demo shop's closed history (set REBUTTAL_SEED_HISTORY=0 to skip).
  if (paypal().mode === "mock")
    return lruGet(store.mock, visitor().id, () => new Map(process.env.REBUTTAL_SEED_HISTORY === "0" ? [] : historyCases().map((c) => [c.id, c])));
  if (!store.sandbox) {
    store.sandbox = new Map();
    try {
      store.sandbox = new Map((JSON.parse(fs.readFileSync(FILE, "utf8")) as CaseRecord[]).map((c) => [c.id, c]));
    } catch {
      // first run
    }
  }
  return store.sandbox;
}

function persist() {
  if (paypal().mode !== "sandbox") return;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify([...load().values()], null, 2));
}

export function upsertFromDispute(d: Dispute): CaseRecord {
  const map = load();
  const existing = map.get(d.dispute_id);
  const rec: CaseRecord = existing
    ? { ...existing, dispute: d, updated_at: new Date().toISOString() }
    : { id: d.dispute_id, dispute: d, status: "NEW", trace: [], updated_at: new Date().toISOString() };
  // PayPal may close a dispute outside the app (a ruling, or a dispute decided before this
  // server started); show that result instead of offering to investigate a closed case.
  if (!rec.outcome && d.dispute_outcome?.outcome_code) {
    const o = outcomeFor(d, rec.submitted?.decision);
    if (o) Object.assign(rec, { outcome: o, status: o.result });
  }
  map.set(rec.id, rec);
  persist();
  return rec;
}

export async function syncCases(): Promise<CaseRecord[]> {
  const disputes = await paypal().listDisputes();
  disputes.forEach(upsertFromDispute);
  return listCases();
}

export function listCases(): CaseRecord[] {
  return [...load().values()].sort((a, b) => b.dispute.create_time.localeCompare(a.dispute.create_time));
}

export function getCase(id: string): CaseRecord | undefined {
  return load().get(id);
}

export function updateCase(id: string, patch: Partial<CaseRecord> & { status?: CaseStatus }): CaseRecord {
  const map = load();
  const cur = map.get(id);
  if (!cur) throw new Error(`Unknown case ${id}`);
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  map.set(id, next);
  persist();
  return next;
}

// Adds a seller-facing alert to the case; the inbox shows the newest across all cases.
export function addActivity(id: string, text: string, tone: ActivityItem["tone"] = "info"): CaseRecord | undefined {
  const c = getCase(id);
  if (!c) return undefined;
  return updateCase(id, { activity: [...(c.activity ?? []), { at: new Date().toISOString(), text, tone }].slice(-20) });
}

export function resetCases() {
  if (paypal().mode === "mock") g.__rebuttalCases?.mock.delete(visitor().id);
  else if (g.__rebuttalCases) g.__rebuttalCases.sandbox = new Map();
  persist();
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
