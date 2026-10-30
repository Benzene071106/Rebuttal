"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShieldRow } from "@/lib/shield";

const RISK_COLOR = { HIGH: "var(--danger)", MEDIUM: "var(--offer)", LOW: "var(--fight)" } as const;

// Dispute shield: paid orders waiting to ship, each checked by the agent for dispute
// risk before the seller ships it, using the buyer's dispute history with the shop.
export default function ShieldPanel({ viewOnly }: { viewOnly: boolean }) {
  const [orders, setOrders] = useState<ShieldRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/orders", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    setOrders(json.orders);
  }, []);

  const checking = orders?.some((o) => o.status === "CHECKING") ?? true;
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [checking, load]);

  async function recheck(id: string) {
    setOrders((os) => os?.map((o) => (o.order_id === id ? { ...o, status: "CHECKING", trace: [] } : o)) ?? null);
    const res = await fetch(`/api/orders/${id}/check`, { method: "POST" });
    if (!res.ok) setError((await res.json()).error);
    load();
  }

  if (!orders?.length) return null;
  const flagged = orders.filter((o) => o.verdict && o.verdict.risk !== "LOW");
  const held = flagged.reduce((n, o) => n + Number(o.amount), 0);

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Dispute shield: paid orders, not shipped yet</h2>
          <p className="text-xs text-muted">Before you ship, the agent checks each PayPal order for dispute risk, including every dispute this buyer has filed with you before.</p>
        </div>
        {flagged.length ? (
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: "var(--danger)", border: "1px solid currentColor" }}>
            {flagged.length} to review before shipping (${held.toFixed(0)})
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

      <ul className="mt-3 divide-y divide-line">
        {orders.map((o) => {
          const v = o.verdict;
          const expanded = open === o.order_id;
          return (
            <li key={o.order_id} className="py-2.5">
              <button onClick={() => setOpen(expanded ? null : o.order_id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left" aria-expanded={expanded}>
                <span className="w-20 text-xs text-muted tabular">{o.invoice_id}</span>
                <span className="min-w-40 flex-1">
                  <span className="block text-sm font-medium">{o.buyer}</span>
                  <span className="block truncate text-xs text-muted">{o.item} · ships to {o.ship_to}</span>
                </span>
                <span className="w-20 text-right text-sm font-semibold tabular">${Number(o.amount).toFixed(2)}</span>
                <span className="w-56 text-right">
                  {o.status === "CHECKING" ? (
                    <span className="text-xs text-muted">Checking… {o.trace.at(-1)?.tool ? `(${o.trace.at(-1)!.tool})` : ""}</span>
                  ) : o.status === "ERROR" ? (
                    <span className="text-xs text-danger">Check failed</span>
                  ) : v ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: RISK_COLOR[v.risk], border: "1px solid currentColor" }}>
                        {v.risk} risk
                      </span>
                      <span className="text-xs text-muted tabular">{Math.round(v.score)}/100</span>
                    </span>
                  ) : null}
                </span>
              </button>
              {v && o.status === "READY" ? <p className="mt-1 pl-24 text-sm">{v.headline}</p> : null}
              {o.status === "ERROR" ? <p className="mt-1 pl-24 text-xs text-muted">{o.error}</p> : null}
              {expanded && v ? (
                <div className="mt-2 grid gap-3 pl-24 md:grid-cols-2">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">What the agent found</h3>
                    <ul className="mt-1 space-y-1 text-sm">
                      {v.signals.map((s, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="font-semibold" style={{ color: s.effect === "RAISES" ? "var(--danger)" : "var(--fight)" }}>{s.effect === "RAISES" ? "▲" : "▼"}</span>
                          <span>
                            {s.finding} <span className="text-xs text-muted">({s.source})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Before you ship</h3>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                      {v.actions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ol>
                    <p className="mt-2 text-xs text-muted">
                      {o.model} · {o.trace.filter((t) => t.kind === "tool").map((t) => t.tool).join(", ")}
                      {viewOnly ? null : (
                        <>
                          {" · "}
                          <button onClick={() => recheck(o.order_id)} className="underline hover:text-ink">Re-check</button>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
