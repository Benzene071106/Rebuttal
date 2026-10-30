// Seller rules for autopilot. Simulator rules belong to each visitor, like their cases;
// the live sandbox is one PayPal account, so its rules are shared and saved to disk.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AutopilotRules, CaseRecord } from "./types";
import { lruGet, visitor } from "./visitor";

export const DEFAULT_RULES: AutopilotRules = { enabled: true, auto_refund_max: 30, auto_fight_min_win: 0, max_auto_amount: 250 };

export const RulesSchema = z.object({
  enabled: z.boolean(),
  auto_refund_max: z.number().min(0).max(10_000),
  auto_fight_min_win: z.number().min(0).max(1),
  max_auto_amount: z.number().min(0).max(10_000),
});

const FILE = path.join(process.cwd(), "data", "rules.json");
const g = globalThis as unknown as { __rebuttalRules?: { sandbox?: AutopilotRules; mock: Map<string, AutopilotRules> } };

export function getRules(): AutopilotRules {
  g.__rebuttalRules ??= { mock: new Map() };
  const store = g.__rebuttalRules;
  if (visitor().mode === "mock") return lruGet(store.mock, visitor().id, () => ({ ...DEFAULT_RULES }));
  if (!store.sandbox) {
    try {
      store.sandbox = RulesSchema.parse(JSON.parse(fs.readFileSync(FILE, "utf8")));
    } catch {
      store.sandbox = { ...DEFAULT_RULES };
    }
  }
  return store.sandbox;
}

export function setRules(next: AutopilotRules): AutopilotRules {
  const rules = RulesSchema.parse(next);
  g.__rebuttalRules ??= { mock: new Map() };
  if (visitor().mode === "mock") g.__rebuttalRules.mock.set(visitor().id, rules);
  else {
    g.__rebuttalRules.sandbox = rules;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(rules, null, 2));
  }
  return rules;
}

export function resetRules() {
  if (visitor().mode === "mock") g.__rebuttalRules?.mock.delete(visitor().id);
}

export type RuleVerdict =
  | { act: "REFUND" | "FIGHT"; reason: string }
  | { act: null; reason: string };

// Decides what autopilot may do with a finished investigation. Guardrails come first:
// anything over the hard cap, an investigation that hit tool errors, or a partial-refund
// offer always goes to the seller.
export function evaluateRules(c: CaseRecord, rules: AutopilotRules): RuleVerdict {
  const r = c.recommendation;
  const amount = Number(c.dispute.dispute_amount.value);
  const fmt = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;
  if (!rules.enabled) return { act: null, reason: "Autopilot is off, so every dispute waits for your approval." };
  if (!r) return { act: null, reason: "No recommendation yet." };
  if (c.submitted || c.outcome) return { act: null, reason: "This dispute already has a response." };
  if (amount > rules.max_auto_amount) return { act: null, reason: `${fmt(amount)} is above your ${fmt(rules.max_auto_amount)} autopilot limit, so you decide.` };
  if (c.trace.some((s) => s.kind === "error")) return { act: null, reason: "Some PayPal lookups failed during the investigation, so a person should check it." };
  if (r.decision === "REFUND") {
    if (amount <= rules.auto_refund_max) return { act: "REFUND", reason: `The AI recommends a refund and ${fmt(amount)} is within your auto-refund limit of ${fmt(rules.auto_refund_max)}.` };
    return { act: null, reason: `The AI recommends a refund, but ${fmt(amount)} is above your auto-refund limit of ${fmt(rules.auto_refund_max)}.` };
  }
  if (r.decision === "FIGHT") {
    if (rules.auto_fight_min_win <= 0) return { act: null, reason: "Auto-fight is off, so evidence is only sent after you approve it." };
    const pct = Math.round(r.win_probability * 100);
    const need = Math.round(rules.auto_fight_min_win * 100);
    if (r.win_probability >= rules.auto_fight_min_win) return { act: "FIGHT", reason: `The AI puts the win chance at ${pct}%, at or above your auto-fight threshold of ${need}%.` };
    return { act: null, reason: `The AI puts the win chance at ${pct}%, below your auto-fight threshold of ${need}%.` };
  }
  return { act: null, reason: "Partial-refund offers always need your approval, because you choose the amount." };
}
