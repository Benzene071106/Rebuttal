"use client";

import Link from "next/link";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useState } from "react";
import type { ActivityItem, AutopilotRules, CaseRecord } from "@/lib/types";
import { useCases } from "./CasesProvider";
import { gridTheme } from "./grid";
import { BUTTON, Empty } from "./ui";

const TONE: Record<ActivityItem["tone"], string> = { info: "var(--accent)", good: "var(--fight)", warn: "var(--danger)", bad: "var(--refund)" };

type RuleKey = keyof AutopilotRules;
type RuleRow = {
  key: RuleKey;
  label: string;
  help: string;
  kind: "bool" | "money" | "pct";
  min: number;
  max: number;
  // Percent rules are edited as 0-100 and stored as 0-1.
  value: number | boolean;
  error: string | null;
};

const RULE_META: Array<Omit<RuleRow, "value" | "error">> = [
  { key: "enabled", label: "Autopilot", help: "Investigate each new PayPal dispute right away and follow the rules below.", kind: "bool", min: 0, max: 1 },
  { key: "auto_refund_max", label: "Refund on its own up to", help: "When the AI says refund and the amount is at most this.", kind: "money", min: 0, max: 10_000 },
  { key: "auto_fight_min_win", label: "Send evidence on its own at", help: "AI win chance at or above this. 0 means never; otherwise 50 to 100.", kind: "pct", min: 0, max: 100 },
  { key: "max_auto_amount", label: "Hard cap", help: "Never act alone, or in a bulk approve, above this amount.", kind: "money", min: 0, max: 10_000 },
  { key: "negotiate_max_pct", label: "Negotiator may refund at most", help: "Share of the order the agent may give back when you hand it a partial refund. 5 to 95.", kind: "pct", min: 5, max: 95 },
];

const toGrid = (k: RuleKey, v: AutopilotRules[RuleKey]) => (typeof v === "boolean" ? v : k === "auto_fight_min_win" || k === "negotiate_max_pct" ? Math.round(Number(v) * 100) : Number(v));
const fromGrid = (k: RuleKey, v: number | boolean) => (typeof v === "boolean" ? v : k === "auto_fight_min_win" || k === "negotiate_max_pct" ? v / 100 : v);

// Validation for one cell, with the other cells for the rules that depend on each other.
export function ruleError(k: RuleKey, v: unknown, all: AutopilotRules): string | null {
  const meta = RULE_META.find((m) => m.key === k)!;
  if (meta.kind === "bool") return typeof v === "boolean" ? null : "On or off.";
  const n = Number(v);
  if (v === null || v === "" || !Number.isFinite(n)) return "Enter a number.";
  if (n < meta.min || n > meta.max) return `Between ${meta.min} and ${meta.max.toLocaleString()}.`;
  if (meta.kind === "money" && Math.round(n * 100) !== n * 100) return "Whole cents only.";
  if (k === "auto_fight_min_win" && n > 0 && n < 50) return "0 (never) or 50 to 100.";
  if (k === "auto_refund_max" && n > all.max_auto_amount) return `Can't be above the $${all.max_auto_amount} hard cap.`;
  if (k === "max_auto_amount" && n < all.auto_refund_max) return `Below your $${all.auto_refund_max} refund limit; lower that first.`;
  return null;
}

function RuleLabel({ data }: ICellRendererParams<RuleRow>) {
  if (!data) return null;
  return (
    <div className="py-2 leading-snug">
      <div className="font-medium">{data.label}</div>
      <div className="text-xs text-muted">{data.help}</div>
    </div>
  );
}
function RuleCheck({ data }: ICellRendererParams<RuleRow>) {
  if (!data) return null;
  return data.error ? (
    <span className="block py-2 text-xs leading-snug text-danger">{data.error}</span>
  ) : (
    <span className="text-xs" style={{ color: "var(--fight)" }}>✓ OK</span>
  );
}

// The seller's autopilot rules as an editable AG Grid: click a value to edit it in place
// (checkbox and number cell editors), with each cell validated as you type it and the
// rules that depend on each other checked together. Lives in the settings drawer.
export function RulesForm() {
  const { data, rules: savedRules, setRules: setSaved } = useCases();
  const viewOnly = Boolean(data?.viewOnly);
  const [draft, setDraft] = useState<AutopilotRules | null>(savedRules);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(savedRules), [savedRules]);

  const rows = useMemo<RuleRow[]>(
    () => (draft ? RULE_META.map((m) => ({ ...m, value: toGrid(m.key, draft[m.key]), error: ruleError(m.key, toGrid(m.key, draft[m.key]), draft) })) : []),
    [draft],
  );

  const cols = useMemo<ColDef<RuleRow>[]>(
    () => [
      { field: "label", headerName: "Rule", flex: 1.6, minWidth: 200, cellRenderer: RuleLabel, autoHeight: true, wrapText: true, sortable: false },
      {
        field: "value",
        headerName: "Value",
        width: 110,
        // Mixed types in one column: switch off type inference, pick the editor per row.
        cellDataType: false,
        sortable: false,
        editable: (p) => !viewOnly && (p.data?.key === "enabled" || Boolean(draft?.enabled)),
        cellEditorSelector: (p) =>
          p.data?.kind === "bool"
            ? { component: "agCheckboxCellEditor" }
            : { component: "agNumberCellEditor", params: { min: p.data?.min, max: p.data?.max, precision: p.data?.kind === "money" ? 2 : 0, step: p.data?.kind === "money" ? 1 : 5, showStepperButtons: true } },
        valueFormatter: (p) => {
          const r = p.data;
          if (!r) return "";
          if (r.kind === "bool") return p.value ? "On" : "Off";
          if (r.key === "auto_fight_min_win" && p.value === 0) return "Never";
          return r.kind === "money" ? `$${Number(p.value).toLocaleString()}` : `${p.value}%`;
        },
        // Accept the edit into the draft; validation runs on the whole draft, so a fix to
        // one rule clears the error it caused on another.
        valueSetter: (p) => {
          if (!p.data || !draft) return false;
          const v = p.data.kind === "bool" ? Boolean(p.newValue) : p.newValue === null || p.newValue === "" ? NaN : Number(p.newValue);
          setDraft({ ...draft, [p.data.key]: fromGrid(p.data.key, v) });
          return true;
        },
        cellStyle: (p) => ({
          display: "flex",
          alignItems: "center",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: p.data?.error ? "var(--danger)" : "inherit",
          boxShadow: p.data?.error ? "inset 0 0 0 2px var(--danger)" : "none",
          cursor: viewOnly ? "default" : "pointer",
        }),
        tooltipValueGetter: () => (viewOnly ? "View-only here" : "Click to edit"),
      },
      { colId: "check", headerName: "Check", flex: 1, minWidth: 120, cellRenderer: RuleCheck, sortable: false, wrapText: true, autoHeight: true },
    ],
    [draft, viewOnly],
  );

  async function save() {
    if (!draft) return;
    setSaving(true);
    const res = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setError(json.error);
    setError(null);
    setSaved(json);
  }

  if (!draft) return <p className="text-sm text-muted">Loading rules...</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedRules);
  const invalid = rows.filter((r) => r.error).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Click a value to edit it. Each cell is checked as you change it.</p>
      <AgGridReact<RuleRow>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        getRowId={(p) => p.data.key}
        domLayout="autoHeight"
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        tooltipShowDelay={300}
        defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" } }}
      />
      <p className="text-xs text-muted">Always left to you: partial-refund offers, anything over the hard cap, and any investigation where a PayPal lookup failed. If PayPal itself fails, the agent retries or explains, but never raises these limits.</p>
      {dirty && !viewOnly ? (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || invalid > 0} className={BUTTON.primary}>
            {saving ? "Saving..." : "Save rules"}
          </button>
          <button onClick={() => setDraft(savedRules)} className={BUTTON.ghost}>Undo changes</button>
          {invalid ? <span className="text-xs text-danger">Fix {invalid} cell{invalid === 1 ? "" : "s"} to save.</span> : null}
        </div>
      ) : null}
      {viewOnly ? <p className="text-xs text-muted">View-only on the hosted live sandbox. Switch to the Simulator to change rules.</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

// Today's alerts show the time; older ones (the demo shop's history) show the date.
const when = (at: string) => {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

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
            <span className="text-muted tabular">{when(a.at)}</span>{" "}
            <span className="font-medium">{a.c.dispute.disputed_transactions[0]?.buyer?.name ?? a.c.id}:</span> {a.text}
          </Link>
        </li>
      ))}
    </ol>
  );
}
