"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ActivityItem, AutopilotRules, CaseRecord } from "@/lib/types";
import { useCases } from "./CasesProvider";
import { BUTTON, Empty } from "./ui";

const TONE: Record<ActivityItem["tone"], string> = { info: "var(--accent)", good: "var(--fight)", warn: "var(--danger)", bad: "var(--refund)" };

// The seller's autopilot rules: what the agent may do on its own when a PayPal webhook
// brings a new dispute. Lives in the Settings drawer.
export function RulesForm() {
  const { data, rules: savedRules, setRules: setSaved } = useCases();
  const viewOnly = Boolean(data?.viewOnly);
  const [rules, setRules] = useState<AutopilotRules | null>(savedRules);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRules(savedRules), [savedRules]);

  async function save() {
    if (!rules) return;
    setSaving(true);
    const res = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rules) });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setError(json.error);
    setError(null);
    setSaved(json);
  }

  if (!rules) return <p className="text-sm text-muted">Loading rules...</p>;
  const dirty = JSON.stringify(rules) !== JSON.stringify(savedRules);
  const set = (patch: Partial<AutopilotRules>) => setRules({ ...rules, ...patch });
  const num = (v: string) => (v === "" ? 0 : Math.max(0, Number(v)));

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
        <span>
          <span className="font-medium">Autopilot</span>
          <span className="block text-xs text-muted">When PayPal reports a new dispute, the agent investigates it right away and follows these rules.</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <input type="checkbox" checked={rules.enabled} disabled={viewOnly} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
          {rules.enabled ? "On" : "Off"}
        </span>
      </label>
      <fieldset disabled={viewOnly || !rules.enabled} className="space-y-3 text-sm disabled:opacity-60">
        <label className="flex flex-wrap items-center gap-2">
          Refund on its own when the AI says refund and the amount is at most
          <span className="flex items-center">$<input aria-label="Auto-refund limit" value={rules.auto_refund_max} onChange={(e) => set({ auto_refund_max: num(e.target.value) })} inputMode="decimal" className="ml-0.5 w-16 rounded border border-line bg-bg px-1.5 py-0.5 tabular" /></span>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          Send evidence on its own when the AI&apos;s win chance is at least
          <select aria-label="Auto-fight threshold" value={rules.auto_fight_min_win} onChange={(e) => set({ auto_fight_min_win: Number(e.target.value) })} className="rounded border border-line bg-bg px-1.5 py-0.5">
            <option value={0}>never</option>
            <option value={0.95}>95%</option>
            <option value={0.9}>90%</option>
            <option value={0.8}>80%</option>
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          Never act on its own above
          <span className="flex items-center">$<input aria-label="Autopilot hard limit" value={rules.max_auto_amount} onChange={(e) => set({ max_auto_amount: num(e.target.value) })} inputMode="decimal" className="ml-0.5 w-16 rounded border border-line bg-bg px-1.5 py-0.5 tabular" /></span>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          When you hand a partial refund to the agent, it may refund at most
          <select aria-label="Negotiation ceiling" value={rules.negotiate_max_pct} onChange={(e) => set({ negotiate_max_pct: Number(e.target.value) })} className="rounded border border-line bg-bg px-1.5 py-0.5">
            {[0.25, 0.3, 0.4, 0.5].map((p) => <option key={p} value={p}>{Math.round(p * 100)}%</option>)}
          </select>
          of the order
        </label>
      </fieldset>
      <p className="text-xs text-muted">Always left to you: partial-refund offers, anything over the limit, and any investigation where a PayPal lookup failed. If PayPal itself fails, the agent retries or explains, but never raises these limits.</p>
      {dirty && !viewOnly ? (
        <button onClick={save} disabled={saving} className={BUTTON.primary}>
          {saving ? "Saving..." : "Save rules"}
        </button>
      ) : null}
      {viewOnly ? <p className="text-xs text-muted">View-only on the hosted live sandbox. Switch to the Simulator to change rules.</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

// What autopilot and PayPal's webhooks did, newest first.
export function AlertsFeed({ cases, mode, limit = 6 }: { cases: CaseRecord[]; mode?: "mock" | "sandbox"; limit?: number }) {
  const feed = cases
    .flatMap((c) => (c.activity ?? []).map((a) => ({ ...a, c })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
  if (!feed.length) {
    return (
      <Empty>
        {mode === "sandbox"
          ? "No alerts yet. New disputes filed by sandbox buyers arrive here through PayPal's webhook."
          : "No alerts yet. Open Simulator tools and simulate a new dispute to watch autopilot handle it."}
      </Empty>
    );
  }
  return (
    <ol className="space-y-2" aria-live="polite">
      {feed.map((a, i) => (
        <li key={`${a.c.id}-${a.at}-${i}`} className="flex gap-2 text-sm">
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONE[a.tone] }} />
          <Link href={`/cases/${a.c.id}`} className="hover:underline">
            <span className="text-muted tabular">{new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{" "}
            <span className="font-medium">{a.c.dispute.disputed_transactions[0]?.buyer?.name ?? a.c.id}:</span> {a.text}
          </Link>
        </li>
      ))}
    </ol>
  );
}
