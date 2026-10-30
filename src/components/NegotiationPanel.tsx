"use client";

import type { CaseRecord, NegotiationTurn } from "@/lib/types";
import { money } from "./format";

const STATUS: Record<string, string> = {
  ACTIVE: "Negotiating",
  WAITING_FOR_BUYER: "Waiting for the buyer's reply",
  SETTLED: "Settled",
  HANDED_BACK: "Handed back to you",
};

// The agent's conversation with the buyer: what each side said and asked for, and
// (for the seller only) why the agent made each move.
export default function NegotiationPanel({ c, live, busy }: { c: CaseRecord; live: NegotiationTurn[] | null; busy: boolean }) {
  const n = c.negotiation!;
  const turns = live ?? n.turns;
  const currency = c.dispute.dispute_amount.currency_code;
  return (
    <section className="space-y-3 rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Agent negotiating with the buyer</h2>
        <span className="text-xs text-muted">
          {busy ? "Negotiating" : STATUS[n.status]} &middot; your ceiling {money(n.max_refund, currency)} (never shown to the buyer)
        </span>
      </div>
      <ol className="space-y-3">
        {turns.map((t, i) =>
          t.from === "AGENT" && !t.text ? (
            <li key={i} className="text-sm text-muted">Agent stopped: {t.reasoning}</li>
          ) : (
            <li key={i} className={`flex flex-col gap-1 ${t.from === "AGENT" ? "items-end" : "items-start"}`}>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                {t.from === "AGENT" ? "Agent, for you" : "Buyer"}
                {t.amount !== undefined ? ` · ${t.from === "AGENT" ? "offers" : "asks"} ${money(t.amount, currency)}` : ""}
              </div>
              <div
                className="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed"
                style={t.from === "AGENT" ? { background: "var(--accent-soft)" } : { background: "var(--bg)", border: "1px solid var(--line)" }}
              >
                {t.text}
              </div>
              {t.from === "AGENT" && t.reasoning ? (
                <div className="max-w-[85%] text-right text-xs text-muted">
                  Why: {t.reasoning}
                  {t.by === "rules" ? " (rule-based fallback; the AI model was unavailable)" : ""}
                </div>
              ) : null}
            </li>
          ),
        )}
        {busy ? (
          <li className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-muted" />
            {turns.at(-1)?.from === "AGENT" ? "Waiting for the buyer..." : "Agent is thinking..."}
          </li>
        ) : null}
      </ol>
      {n.note && !busy ? <p className="rounded-md border border-line bg-bg px-3 py-2 text-sm">{n.note}</p> : null}
    </section>
  );
}
