"use client";

import type { CaseRecord, Decision } from "@/lib/types";
import { DECISION_COLOR, DECISION_LABEL, money } from "./format";

const WEIGHT_DOTS = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

// Shows the seller why the agent chose what it did: the facts on each side, the expected
// money of each option, and what autopilot did with it under the seller's rules.
export default function WhyPanel({ c, toolLabel }: { c: CaseRecord; toolLabel: Record<string, string> }) {
  const r = c.recommendation!;
  const amount = Number(c.dispute.dispute_amount.value);
  const currency = c.dispute.dispute_amount.currency_code;
  const factors = r.factors ?? [];
  const options: Array<{ d: Decision; keep: number; note: string }> = [
    { d: "FIGHT", keep: r.win_probability * amount, note: `${Math.round(r.win_probability * 100)}% x ${money(amount, currency)}, decided by PayPal in weeks` },
    ...(r.decision === "OFFER" && r.offer_amount > 0
      ? [{ d: "OFFER" as Decision, keep: amount - r.offer_amount, note: `${money(amount, currency)} minus a ${money(r.offer_amount, currency)} offer, if the buyer accepts` }]
      : []),
    { d: "REFUND", keep: 0, note: "Closes the case today, no more time spent" },
  ];

  return (
    <section className="space-y-4 rounded-lg border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">Why this decision</h2>

      {factors.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["SELLER", "BUYER"] as const).map((side) => (
            <div key={side}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{side === "SELLER" ? "In your favor" : "In the buyer's favor"}</h3>
              <ul className="space-y-1.5">
                {factors.filter((f) => f.favors === side).map((f, i) => (
                  <li key={i} className="text-sm leading-snug">
                    <span className="mr-1.5 inline-flex gap-0.5 align-middle" title={`${f.weight.toLowerCase()} weight`} aria-label={`${f.weight.toLowerCase()} weight`}>
                      {[1, 2, 3].map((n) => (
                        <span key={n} className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: n <= WEIGHT_DOTS[f.weight] ? (side === "SELLER" ? "var(--fight)" : "var(--refund)") : "var(--line)" }} />
                      ))}
                    </span>
                    {f.finding} <span className="text-xs text-muted">({toolLabel[f.source] ?? f.source})</span>
                  </li>
                ))}
                {factors.every((f) => f.favors !== side) ? <li className="text-sm text-muted">Nothing found.</li> : null}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Expected money kept</h3>
        <ul className="space-y-1.5">
          {options.map((o) => (
            <li key={o.d} className="flex items-baseline gap-3 text-sm">
              <span className="w-28 shrink-0 font-medium" style={{ color: DECISION_COLOR[o.d] }}>
                {DECISION_LABEL[o.d]}
                {o.d === r.decision ? " *" : ""}
              </span>
              <span className="w-20 shrink-0 text-right font-semibold tabular">{money(o.keep, currency)}</span>
              <span className="text-xs text-muted">{o.note}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs text-muted">* The agent&apos;s pick. It also weighs the deadline, the time a fight takes, and the risks listed below.</p>
      </div>

      {c.autopilot ? (
        <div className="rounded-md border border-line bg-bg px-3 py-2 text-sm">
          <span className="font-medium">
            {c.autopilot.action === "AUTO_REFUNDED" ? "Autopilot refunded this dispute. " : c.autopilot.action === "AUTO_FOUGHT" ? "Autopilot sent the evidence. " : c.autopilot.action === "FAILED" ? "Autopilot couldn't finish. " : "Autopilot left this to you. "}
          </span>
          <span className="text-muted">{c.autopilot.reason}</span>
        </div>
      ) : null}
    </section>
  );
}
