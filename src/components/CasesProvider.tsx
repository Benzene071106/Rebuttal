"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AutopilotRules, CaseRecord } from "@/lib/types";

export type Stats = {
  open: number; at_risk: number; kept: number; won: number; decided: number; rulings: number;
  answered: number; autopilot: number; hours_saved: number; due_soon: number; due_soon_amount: number;
};
export type Payload = { mode: "mock" | "sandbox"; sandboxAvailable?: boolean; viewOnly?: boolean; cases: CaseRecord[]; stats: Stats; network?: Record<string, number> };

type Ctx = {
  data: Payload | null;
  error: string | null;
  setError: (e: string | null) => void;
  reload: () => Promise<void>;
  rules: AutopilotRules | null;
  setRules: (r: AutopilotRules) => void;
  switchMode: (mode: "mock" | "sandbox") => Promise<void>;
};

const CasesContext = createContext<Ctx | null>(null);

// One poller for the whole app: the top bar, the three pages and the settings drawer all
// read the same disputes, stats and autopilot rules.
export default function CasesProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<AutopilotRules | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/cases", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) setError(json.error);
    else {
      setError(null);
      setData(json);
    }
  }, []);

  // Poll quickly while autopilot is working on a dispute, so its alerts show up live.
  const working = Boolean(data?.cases.some((c) => c.status === "ANALYZING"));
  useEffect(() => {
    reload();
    const t = setInterval(reload, working ? 1500 : 8000);
    return () => clearInterval(t);
  }, [reload, working]);

  // Simulator and live sandbox keep separate rules, so reload them when the mode switches.
  const mode = data?.mode;
  useEffect(() => {
    if (!mode) return;
    fetch("/api/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then(setRules)
      .catch(() => {});
  }, [mode]);

  const switchMode = useCallback(
    async (next: "mock" | "sandbox") => {
      if (next === data?.mode) return;
      const res = await fetch("/api/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: next }) });
      const json = await res.json();
      if (!res.ok) return setError(json.error);
      setData(null);
      await reload();
    },
    [data?.mode, reload],
  );

  return <CasesContext.Provider value={{ data, error, setError, reload, rules, setRules, switchMode }}>{children}</CasesContext.Provider>;
}

export function useCases(): Ctx {
  const ctx = useContext(CasesContext);
  if (!ctx) throw new Error("useCases must be used inside CasesProvider");
  return ctx;
}
