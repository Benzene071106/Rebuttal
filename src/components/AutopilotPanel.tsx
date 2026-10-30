"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ActivityItem, AutopilotRules, CaseRecord } from "@/lib/types";

const TONE: Record<ActivityItem["tone"], string> = { info: "var(--accent)", good: "var(--fight)", warn: "var(--danger)", bad: "var(--refund)" };

// Autopilot rules the seller sets, and the alerts autopilot raises as PayPal webhooks
// arrive and investigations finish.
export default function AutopilotPanel({ cases, mode, viewOnly }: { cases: CaseRecord[]; mode?: "mock" | "sandbox"; viewOnly: boolean }) {
  const [rules, setRules] = useState<AutopilotRules | null>(null);
  const [saved, setSaved] = useState<AutopilotRules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Simulator and live sandbox keep separate rules, so reload them when the mode switches.
  useEffect(() => {
    if (!mode) return;
    fetch("/api/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((r: AutopilotRules) => {
        setRules(r);
        setSaved(r);
      })
      .catch(() => {});
  }, [mode]);

  async function save() {
    if (!rules) return;
    setSaving(true);
    const res = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rules) });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setError(json.error);
    setError(null);
    setRules(json);
    setSaved(json);
  }

  const feed = cases
    .flatMap((c) => (c.activity ?? []).map((a) => ({ ...a, c })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved);
  const set = (patch: Partial<AutopilotRules>) => rules && setRules({ ...rules, ...patch });
  const num = (v: string) => (v === "" ? 0 : Math.max(0, Number(v)));

  return (
    <section className="grid gap-4 rounded-lg border border-line bg-panel p-4 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Autopilot</h2>
            <p className="text-xs text-muted">When PayPal reports a new dispute, the agent investigates it right away and follows your rules.</p>
          </div>
          {rules ? (
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input type="checkbox" checked={rules.enabled} disabled={viewOnly} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
              {rules.enabled ? "On" : "Off"}
            </label>
          ) : null}
        </div>
        {rules ? (
          <fieldset disabled={viewOnly || !rules.enabled} className="space-y-2 text-sm disabled:opacity-60">
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
            <p className="text-xs text-muted">Always left to you: partial-refund offers, anything over the limit, and any investigation where a PayPal lookup failed.</p>
          </fieldset>
        ) : null}
        {dirty && !viewOnly ? (
          <button onClick={save} disabled={saving} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-panel disabled:opacity-60">
            {saving ? "Saving..." : "Save rules"}
          </button>
        ) : null}
        {viewOnly ? <p className="text-xs text-muted">View-only on the hosted live sandbox. Switch to the Simulator to change rules.</p> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Alerts</h3>
        {feed.length === 0 ? (
          <p className="text-sm text-muted">No alerts yet. Simulate a new dispute to watch a PayPal webhook arrive and autopilot handle it.</p>
        ) : (
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
        )}
      </div>
    </section>
  );
}
