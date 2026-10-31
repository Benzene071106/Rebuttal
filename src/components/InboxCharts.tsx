"use client";

import { AllCommunityModule, ModuleRegistry, type AgChartOptions } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { useEffect, useMemo, useState } from "react";
import type { CaseRecord, Decision } from "@/lib/types";
import { DECISION_LABEL, money, REASON_LABEL } from "./format";

ModuleRegistry.registerModules([AllCommunityModule]);

// AG Charts draw on a canvas, so CSS variables are read once into real colors (and again
// when the system switches between light and dark).
function usePalette() {
  const read = () => {
    if (typeof window === "undefined") return null;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    return { ink: v("--ink"), muted: v("--muted"), line: v("--line"), panel: v("--panel"), fight: v("--fight"), offer: v("--offer"), refund: v("--refund"), danger: v("--danger"), accent: v("--accent") };
  };
  const [p, setP] = useState(read);
  useEffect(() => {
    setP(read());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setP(read());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return p;
}

// Charts of the disputes the grid is showing right now: they follow the grid's search and
// filters, and clicking a bar filters the grid to that claim type.
export default function InboxCharts({ shown, activeClaim, onClaim }: { shown: CaseRecord[]; activeClaim: string | null; onClaim: (claim: string | null) => void }) {
  const p = usePalette();

  const byClaim = useMemo(() => {
    const rows = new Map<string, { claim: string; atRisk: number; kept: number; refunded: number }>();
    for (const c of shown) {
      const claim = REASON_LABEL[c.dispute.reason] ?? c.dispute.reason;
      const r = rows.get(claim) ?? { claim, atRisk: 0, kept: 0, refunded: 0 };
      if (c.outcome) {
        r.kept += c.outcome.amount_kept;
        r.refunded += c.outcome.amount_lost;
      } else r.atRisk += Number(c.dispute.dispute_amount.value);
      rows.set(claim, r);
    }
    return [...rows.values()];
  }, [shown]);

  const byDecision = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of shown) {
      const d: Decision | undefined = c.submitted?.decision ?? c.recommendation?.decision;
      const key = d ? DECISION_LABEL[d] : "Not investigated";
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return [...count].map(([decision, n]) => ({ decision, n }));
  }, [shown]);

  if (!p || !shown.length) return null;

  const base = {
    background: { fill: p.panel },
    padding: { top: 8, right: 12, bottom: 8, left: 8 },
    legend: { position: "bottom" as const, item: { label: { color: p.muted, fontSize: 12 } } },
  };
  const axisLabel = { color: p.muted, fontSize: 12 };
  const fmt = (v: number) => money(v).replace(/\.00$/, "");

  const bar: AgChartOptions = {
    ...base,
    data: byClaim,
    series: (
      [
        ["atRisk", "At risk", p.offer],
        ["kept", "Kept", p.fight],
        ["refunded", "Refunded", p.refund],
      ] as const
    ).map(([yKey, yName, fill]) => ({
      type: "bar" as const,
      direction: "horizontal" as const,
      xKey: "claim",
      yKey,
      yName,
      stacked: true,
      fill,
      cornerRadius: 3,
      tooltip: { renderer: ({ datum }: { datum: Record<string, number | string> }) => ({ heading: String(datum.claim), title: yName, data: [{ label: "Amount", value: fmt(Number(datum[yKey])) }] }) },
      itemStyler: ({ datum }: { datum: { claim: string } }) => ({ fillOpacity: activeClaim && datum.claim !== activeClaim ? 0.3 : 1 }),
      listeners: { seriesNodeClick: ({ datum }: { datum: { claim: string } }) => onClaim(activeClaim === datum.claim ? null : datum.claim) },
    })),
    axes: {
      x: { type: "category", position: "left", label: axisLabel, line: { stroke: p.line } },
      y: { type: "number", position: "bottom", label: { ...axisLabel, formatter: ({ value }: { value: number }) => fmt(value) }, gridLine: { style: [{ stroke: p.line }] } },
    },
  } as unknown as AgChartOptions;

  const donut: AgChartOptions = {
    ...base,
    data: byDecision,
    series: [
      {
        type: "donut",
        angleKey: "n",
        legendItemKey: "decision",
        innerRadiusRatio: 0.62,
        fills: byDecision.map((d) => ({ Fight: p.fight, "Partial refund": p.offer, Refund: p.refund }[d.decision] ?? `${p.muted}66`)),
        strokeWidth: 2,
        strokes: [p.panel],
        innerLabels: [
          { text: String(shown.length), fontSize: 24, fontWeight: "bold", color: p.ink },
          { text: shown.length === 1 ? "dispute" : "disputes", fontSize: 12, color: p.muted },
        ],
        tooltip: { renderer: ({ datum }: { datum: { decision: string; n: number } }) => ({ heading: datum.decision, data: [{ label: "Disputes", value: String(datum.n) }] }) },
      },
    ],
  } as unknown as AgChartOptions;

  return (
    <section className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
      <div className="rounded-lg border border-line bg-panel p-3">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold">Money by claim type</h2>
          {activeClaim ? (
            <button onClick={() => onClaim(null)} className="text-xs text-accent underline">
              Showing {activeClaim} only. Clear
            </button>
          ) : (
            <span className="text-xs text-muted">Follows the grid&apos;s filters. Click a bar to filter the grid.</span>
          )}
        </div>
        <div className="h-56">
          <AgCharts options={bar} style={{ height: "100%" }} />
        </div>
      </div>
      <div className="rounded-lg border border-line bg-panel p-3">
        <h2 className="px-1 text-sm font-semibold">What the agent decided</h2>
        <div className="h-56">
          <AgCharts options={donut} style={{ height: "100%" }} />
        </div>
      </div>
    </section>
  );
}
