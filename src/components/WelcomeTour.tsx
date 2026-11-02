"use client";

import { useEffect, useState } from "react";
import { TOUR_EVENT } from "./TopBar";
import { BUTTON } from "./ui";

const SEEN_KEY = "rebuttal.tour.seen.v1";

const STEPS = [
  {
    title: "Your disputes, ranked",
    body: "Every PayPal dispute lands here. The agent investigates it through PayPal's own APIs and ranks it by money at risk and days left. Click a row to see its evidence and approve a response.",
  },
  {
    title: "Small claims on autopilot",
    body: "Under your Autopilot rules, the agent refunds small claims it can't win and alerts you about the rest. It never acts above your limit, and it retries or explains when PayPal itself fails.",
  },
  {
    title: "Protect and Insights",
    body: "Protect warns you about buyers other Rebuttal sellers already caught (the repeat-scammer network) and checks paid orders for dispute risk before you ship. Insights shows what the agent did: money kept, hours saved, and every PayPal incident it recovered from.",
  },
];

// A three-step welcome on the first visit; Simulator tools can open it again.
export default function WelcomeTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setStep(0);
    } catch {
      // storage blocked: skip the tour
    }
    const open = () => setStep(0);
    window.addEventListener(TOUR_EVENT, open);
    return () => window.removeEventListener(TOUR_EVENT, open);
  }, []);

  function close() {
    setStep(null);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  }

  if (step === null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="Welcome to Rebuttal">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Step {step + 1} of {STEPS.length}</p>
        <h2 className="mt-1 text-lg font-semibold">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className="h-1.5 w-6 rounded-full" style={{ background: i <= step ? "var(--accent)" : "var(--line)" }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className={BUTTON.ghost}>Skip</button>
            <button onClick={() => (last ? close() : setStep(step + 1))} className={BUTTON.primary}>{last ? "Start" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
