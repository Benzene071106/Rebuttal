"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { REASON_LABEL } from "./format";

type Match = { other_shops: number; reports: Array<{ shop: string; simulated_shop: boolean; reason: keyof typeof REASON_LABEL; evidence: string; outcome: string; at: string }> };

// Shown on a dispute when other Rebuttal shops have reported the same PayPal account.
export default function NetworkBanner({ caseId }: { caseId: string }) {
  const [m, setM] = useState<Match | null>(null);
  useEffect(() => {
    fetch(`/api/network?case=${encodeURIComponent(caseId)}`, { cache: "no-store" }).then((r) => r.json()).then(setM).catch(() => setM(null));
  }, [caseId]);
  if (!m?.other_shops) return null;
  return (
    <section role="note" aria-label="Rebuttal network warning" className="rounded-lg border-2 px-4 py-3" style={{ borderColor: "var(--danger)", background: "color-mix(in srgb, var(--danger) 6%, transparent)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
          Repeat-dispute warning: {m.other_shops} other Rebuttal shop{m.other_shops === 1 ? "" : "s"} reported this PayPal account
        </h2>
        <Link href="/protect" className="text-xs text-accent underline">See the network</Link>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {m.reports.map((r, i) => (
          <li key={i}>
            <span className="font-medium">{REASON_LABEL[r.reason]}</span> at {r.shop}
            {r.simulated_shop ? <span className="text-xs text-muted"> (simulated shop)</span> : null}: {r.evidence}.{" "}
            <span className="text-muted">{r.outcome === "WON" ? "The shop won." : "The shop lost."} {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Shops share only a one-way hash of the buyer&apos;s PayPal email, the claim type and what the evidence showed. Use it as context for your response; PayPal decides each dispute on its own evidence.</p>
    </section>
  );
}
