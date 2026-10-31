"use client";

import type { ColDef, ColumnState, GridApi, ICellRendererParams, IRowNode } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseRecord } from "@/lib/types";
import AutopilotPanel from "./AutopilotPanel";
import IncidentsPanel from "./IncidentsPanel";
import InboxCharts from "./InboxCharts";
import ShieldPanel from "./ShieldPanel";
import Link from "next/link";
import { daysLeft, DECISION_COLOR, DECISION_LABEL, money, priorityOf, REASON_LABEL, statusLabel } from "./format";
import { gridTheme } from "./grid";

type Stats = {
  open: number; at_risk: number; kept: number; won: number; decided: number; rulings: number;
  answered: number; autopilot: number; hours_saved: number; due_soon: number; due_soon_amount: number;
};
type Payload = { mode: "mock" | "sandbox"; sandboxAvailable?: boolean; viewOnly?: boolean; cases: CaseRecord[]; stats: Stats };

// The pinned bottom row carries totals for whatever rows the search and filters leave visible.
type Totals = { count: number; atRisk: number; kept: number; refunded: number };
// A detail row is a full-width copy of its case, placed right under it, that shows the
// agent's reasoning. It carries the case's own values so it passes the same filters.
type Row = CaseRecord & { totals?: Totals; detail?: true };
const isDetail = (n?: IRowNode<Row> | null) => Boolean(n?.data?.detail);
const COL_STATE_KEY = "rebuttal.inbox.columns.v1";

const STAGE_LABEL: Record<string, string> = { INQUIRY: "Inquiry", CHARGEBACK: "Chargeback", PRE_ARBITRATION: "Pre-arbitration", ARBITRATION: "Arbitration" };
const stageOf = (c?: CaseRecord) => (c?.dispute ? STAGE_LABEL[c.dispute.dispute_life_cycle_stage] ?? c.dispute.dispute_life_cycle_stage : undefined);

function totalsOf(rows: CaseRecord[]): Totals {
  const amt = (c: CaseRecord) => Number(c.dispute.dispute_amount.value);
  return {
    count: rows.length,
    atRisk: rows.filter((c) => !c.outcome).reduce((s, c) => s + amt(c), 0),
    kept: rows.reduce((s, c) => s + (c.outcome?.amount_kept ?? 0), 0),
    refunded: rows.reduce((s, c) => s + (c.outcome?.amount_lost ?? 0), 0),
  };
}

function TotalsLabel({ data }: ICellRendererParams<Row>) {
  return <span className="font-semibold">{data?.totals?.count ?? 0} shown</span>;
}
function TotalsAmount({ data }: ICellRendererParams<Row>) {
  return (
    <div className="flex h-full flex-col items-end justify-center leading-tight">
      <span className="tabular font-semibold">{money(data?.totals?.atRisk ?? 0)}</span>
      <span className="text-xs text-muted">at risk</span>
    </div>
  );
}
function TotalsOutcome({ data }: ICellRendererParams<Row>) {
  const t = data?.totals;
  return (
    <div className="flex h-full items-center gap-4 text-sm tabular">
      <span className="font-semibold" style={{ color: "var(--fight)" }}>{money(t?.kept ?? 0)} kept</span>
      <span className="text-muted">{money(t?.refunded ?? 0)} refunded</span>
    </div>
  );
}
const pinned = (component: (p: ICellRendererParams<Row>) => React.ReactNode) => (p: ICellRendererParams<Row>) =>
  p.node.rowPinned ? { component } : undefined;
const blank = () => null;

function BuyerCell({ data }: ICellRendererParams<Row>) {
  const t = data?.dispute.disputed_transactions[0];
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      <span className="font-medium">{t?.buyer?.name ?? "Unknown buyer"}</span>
      <span className="truncate text-xs text-muted">{t?.items?.[0]?.item_description ?? t?.invoice_number}</span>
    </div>
  );
}

function ReasonCell({ data }: ICellRendererParams<Row>) {
  return data?.dispute ? <span>{REASON_LABEL[data.dispute.reason]}</span> : null;
}

function DueCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  if (data.outcome || data.submitted) return <span className="text-muted">Responded</span>;
  const d = daysLeft(data.dispute.seller_response_due_date);
  if (d === null) return <span className="text-muted">-</span>;
  return <span className="tabular font-medium" style={{ color: d <= 3 ? "var(--danger)" : undefined }}>{d <= 0 ? "Overdue" : `${d} day${d === 1 ? "" : "s"}`}</span>;
}

function PriorityCell({ data }: ICellRendererParams<Row>) {
  const p = data?.dispute ? priorityOf(data) : null;
  if (!p?.label) return null;
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: p.label === "Urgent" ? "var(--danger)" : "var(--offer)", border: "1px solid currentColor" }}>
      {p.label}
    </span>
  );
}

function ExpandCell({ data, context }: ICellRendererParams<Row>) {
  if (!data || data.detail) return null;
  const open = (context as GridContext).expanded.has(data.id);
  return (
    <button
      aria-label={open ? "Hide the agent's reasoning" : "Show the agent's reasoning"}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        (context as GridContext).toggle(data.id);
      }}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-ink"
    >
      <span className="inline-block transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }}>▶</span>
    </button>
  );
}

type GridContext = { expanded: Set<string>; toggle: (id: string) => void };

// Full-width row under a case: what the agent found, without opening the case.
function DetailRow({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  const r = data.recommendation;
  const factors = r?.factors ?? [];
  return (
    <div className="flex h-full gap-6 overflow-auto whitespace-normal border-l-4 bg-bg px-6 py-3 text-sm leading-normal" style={{ borderColor: r ? DECISION_COLOR[data.submitted?.decision ?? r.decision] : "var(--line)" }}>
      {r ? (
        <>
          <div className="w-96 min-w-0 shrink-0 space-y-1">
            <p className="font-medium leading-snug">{r.headline}</p>
            <p className="text-xs text-muted">
              {DECISION_LABEL[r.decision]}
              {r.decision === "OFFER" ? ` of ${money(r.offer_amount)}` : ""} · {Math.round(r.win_probability * 100)}% win estimate · {r.evidence.length} evidence item{r.evidence.length === 1 ? "" : "s"}
            </p>
            {data.autopilot ? <p className="text-xs text-muted">Autopilot: {data.autopilot.reason}</p> : null}
            {data.negotiation ? (
              <p className="text-xs text-muted">
                Negotiation: {data.negotiation.status.replaceAll("_", " ").toLowerCase()}, {data.negotiation.turns.length} messages, ceiling {money(data.negotiation.max_refund)}
              </p>
            ) : null}
          </div>
          <ul className="min-w-0 flex-1 space-y-1">
            {factors.slice(0, 4).map((f, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span className="shrink-0 font-semibold" style={{ color: f.favors === "SELLER" ? "var(--fight)" : "var(--danger)" }}>{f.favors === "SELLER" ? "For you" : "For buyer"}</span>
                <span className="truncate" title={f.finding}>{f.finding}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="self-center text-muted">{data.status === "ANALYZING" ? "The agent is investigating this dispute now." : "Not investigated yet. Open the dispute and the agent starts right away."}</p>
      )}
      <Link href={`/cases/${data.id}`} className="shrink-0 self-center rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent">
        Open dispute
      </Link>
    </div>
  );
}

function AgentCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  const r = data.recommendation;
  const decided = data.submitted?.decision ?? r?.decision;
  return (
    <div className="flex h-full items-center gap-3">
      {data.submitted?.by === "autopilot" ? (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent" title={data.autopilot?.reason}>Autopilot</span>
      ) : null}
      {decided ? (
        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: DECISION_COLOR[decided], border: `1px solid ${DECISION_COLOR[decided]}` }}>
          {DECISION_LABEL[decided]}
        </span>
      ) : null}
      <span className="text-sm text-muted">{statusLabel(data)}</span>
      {r && !data.outcome ? (
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted tabular" title="Estimated chance PayPal rules for the seller">
          <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(r.win_probability * 100)}%` }} />
          </span>
          {Math.round(r.win_probability * 100)}%
        </span>
      ) : null}
      {data.outcome ? (
        <span className="ml-auto text-xs font-semibold tabular" style={{ color: data.outcome.amount_kept > 0 ? "var(--fight)" : "var(--refund)" }}>
          {data.outcome.amount_kept > 0 ? `+${money(data.outcome.amount_kept)} kept` : `${money(data.outcome.amount_lost)} refunded`}
        </span>
      ) : null}
    </div>
  );
}

export default function Inbox() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [shown, setShown] = useState<CaseRecord[]>([]);
  const [claim, setClaim] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const grid = useRef<AgGridReact<Row>>(null);

  const toggle = useCallback((id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const context = useMemo<GridContext>(() => ({ expanded, toggle }), [expanded, toggle]);
  // The chevrons read `expanded` from the grid context, so redraw them when it changes.
  useEffect(() => {
    grid.current?.api?.refreshCells({ columns: ["expand"], force: true });
  }, [expanded]);

  const rows = useMemo<Row[]>(
    () => (data?.cases ?? []).flatMap((c) => (expanded.has(c.id) ? [c, { ...c, id: `${c.id}:detail`, detail: true as const }] : [c])),
    [data, expanded],
  );

  const refreshTotals = useCallback((api: GridApi<Row>) => {
    const visible: CaseRecord[] = [];
    api.forEachNodeAfterFilter((n) => n.data && !n.data.detail && visible.push(n.data));
    const next = totalsOf(visible);
    setShown((cur) => (cur.length === visible.length && cur.every((c, i) => c === visible[i]) ? cur : visible));
    // Only update on a real change, so setting the pinned row can't loop back here.
    setTotals((cur) => (cur && JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  }, []);

  function exportCsv() {
    grid.current?.api.exportDataAsCsv({
      fileName: `rebuttal-outcomes-${new Date().toISOString().slice(0, 10)}.csv`,
      columnKeys: ["id", "buyer", "claim", "stage", "amountUsd", "decision", "status", "kept", "refunded", "win"],
      skipPinnedBottom: true,
      shouldRowBeSkipped: (p) => isDetail(p.node),
    });
  }

  const load = useCallback(async () => {
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
    load();
    const t = setInterval(load, working ? 1500 : 8000);
    return () => clearInterval(t);
  }, [load, working]);

  // The simulated buyer files a dispute and PayPal's webhook reaches the agent; the seller
  // stays on the inbox and watches autopilot handle it.
  async function fileDispute() {
    setBusy(true);
    const res = await fetch("/api/demo/dispute", { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    setError(null);
    load();
  }

  async function switchMode(mode: "mock" | "sandbox") {
    if (mode === data?.mode) return;
    const res = await fetch("/api/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setData(null);
    load();
  }

  async function reset() {
    await fetch("/api/demo/reset", { method: "POST" });
    load();
  }

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: "expand",
        headerName: "",
        width: 52,
        minWidth: 52,
        maxWidth: 52,
        resizable: false,
        sortable: false,
        suppressMovable: true,
        lockPosition: "left",
        cellRenderer: ExpandCell,
        cellRendererSelector: pinned(blank),
      },
      { colId: "id", headerName: "Dispute ID", hide: true, valueGetter: (p) => p.data?.id },
      {
        colId: "buyer",
        headerName: "Buyer",
        cellRenderer: BuyerCell,
        cellRendererSelector: pinned(TotalsLabel),
        flex: 1.6,
        minWidth: 220,
        valueGetter: (p) => p.data?.dispute?.disputed_transactions[0]?.buyer?.name,
        getQuickFilterText: (p) => {
          const t = p.data?.dispute?.disputed_transactions[0];
          return [t?.buyer?.name, t?.items?.[0]?.item_description, t?.invoice_number, p.data?.id].filter(Boolean).join(" ");
        },
      },
      {
        colId: "claim",
        headerName: "Claim",
        cellRenderer: ReasonCell,
        cellRendererSelector: pinned(blank),
        flex: 0.9,
        minWidth: 140,
        valueGetter: (p) => p.data?.dispute && REASON_LABEL[p.data.dispute.reason],
        filter: "agTextColumnFilter",
        floatingFilter: true,
      },
      {
        colId: "stage",
        headerName: "Stage",
        flex: 0.7,
        minWidth: 120,
        valueGetter: (p) => stageOf(p.data),
        cellRendererSelector: pinned(blank),
        filter: "agTextColumnFilter",
        floatingFilter: true,
        cellClass: "text-muted",
      },
      {
        colId: "amount",
        headerName: "Amount",
        flex: 0.8,
        minWidth: 120,
        type: "rightAligned",
        valueGetter: (p) => (p.data?.dispute ? Number(p.data.dispute.dispute_amount.value) : undefined),
        valueFormatter: (p) => (p.value == null ? "" : money(p.value)),
        cellRendererSelector: pinned(TotalsAmount),
        cellClass: "tabular font-medium justify-end",
        filter: "agNumberColumnFilter",
        floatingFilter: true,
      },
      {
        colId: "priority",
        headerName: "Priority",
        headerTooltip: "Open disputes ranked by money at risk and days left to respond",
        cellRenderer: PriorityCell,
        cellRendererSelector: pinned(blank),
        flex: 0.6,
        minWidth: 100,
        valueGetter: (p) => (p.data?.dispute ? priorityOf(p.data).score : undefined),
        sort: "desc",
      },
      {
        colId: "due",
        headerName: "Respond within",
        cellRenderer: DueCell,
        cellRendererSelector: pinned(blank),
        flex: 0.8,
        minWidth: 130,
        valueGetter: (p) => (p.data?.submitted ? 999 : daysLeft(p.data?.dispute?.seller_response_due_date)),
      },
      {
        colId: "agent",
        headerName: "Agent",
        cellRenderer: AgentCell,
        cellRendererSelector: pinned(TotalsOutcome),
        // Autopilot and PayPal change these on their own; flash the cell so the seller notices.
        enableCellChangeFlash: true,
        flex: 1.8,
        minWidth: 280,
        valueGetter: (p) => (p.data?.dispute ? statusLabel(p.data) : undefined),
      },
      // Export-only columns for the outcomes CSV.
      { colId: "decision", headerName: "Decision", hide: true, valueGetter: (p) => { const d = p.data?.submitted?.decision ?? p.data?.recommendation?.decision; return d ? DECISION_LABEL[d] : ""; } },
      { colId: "status", headerName: "Status", hide: true, valueGetter: (p) => (p.data?.dispute ? statusLabel(p.data) : "") },
      // Export-only columns: plain numbers so the CSV adds up in a spreadsheet. Open cases count as 0 kept and 0 refunded.
      { colId: "amountUsd", headerName: "Amount (USD)", hide: true, valueGetter: (p) => (p.data?.dispute ? Number(p.data.dispute.dispute_amount.value) : "") },
      { colId: "kept", headerName: "Kept (USD)", hide: true, valueGetter: (p) => p.data?.outcome?.amount_kept ?? 0 },
      { colId: "refunded", headerName: "Refunded (USD)", hide: true, valueGetter: (p) => p.data?.outcome?.amount_lost ?? 0 },
      {
        colId: "win",
        headerName: "AI win estimate",
        hide: true,
        // A refund isn't a bet on PayPal's ruling, so it has no win estimate.
        valueGetter: (p) => {
          const r = p.data?.recommendation;
          if (!r || (p.data?.submitted?.decision ?? r.decision) === "REFUND") return "";
          return `${Math.round(r.win_probability * 100)}%`;
        },
      },
    ],
    [],
  );

  // Clicking a bar in the chart filters the grid's Claim column, and clearing it unfilters.
  const filterClaim = useCallback(async (value: string | null) => {
    const api = grid.current?.api;
    if (!api) return;
    await api.setColumnFilterModel("claim", value ? { filterType: "text", type: "equals", filter: value } : null);
    api.onFilterChanged();
  }, []);

  // Keep the seller's column layout (order, widths, sort) between visits.
  const saveColumns = useCallback((api: GridApi<Row>) => {
    try {
      localStorage.setItem(COL_STATE_KEY, JSON.stringify(api.getColumnState()));
    } catch {}
  }, []);
  const restoreColumns = useCallback((api: GridApi<Row>) => {
    try {
      const raw = localStorage.getItem(COL_STATE_KEY);
      if (raw) api.applyColumnState({ state: JSON.parse(raw) as ColumnState[], applyOrder: true });
    } catch {}
  }, []);

  const s = data?.stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Disputes</h1>
          <p className="text-sm text-muted">The agent investigates each dispute as PayPal reports it and recommends a response. Nothing goes to PayPal without your approval, except what your autopilot rules allow.</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.sandboxAvailable ? (
            <div className="flex rounded-md border border-line p-0.5 text-sm" role="group" aria-label="PayPal mode">
              {(["mock", "sandbox"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  aria-pressed={data.mode === m}
                  className={`rounded px-3 py-1.5 ${data.mode === m ? "bg-accent font-semibold text-panel" : "text-muted hover:text-ink"}`}
                >
                  {m === "mock" ? "Simulator" : "Live PayPal sandbox"}
                </button>
              ))}
            </div>
          ) : null}
          {data?.mode === "mock" ? (
            <button onClick={reset} className="rounded-md px-3 py-2 text-sm text-muted hover:text-ink">Reset demo</button>
          ) : null}
          {/* Live sandbox disputes can only be filed by a sandbox buyer on paypal.com. */}
          {data?.mode === "mock" ? (
            <button onClick={fileDispute} disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-panel disabled:opacity-60">
              {busy ? "Filing..." : "Simulate a new dispute"}
            </button>
          ) : null}
        </div>
      </div>

      {data?.mode === "mock" ? (
        <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-muted">
          Simulator: your own private copy of the demo, so other visitors don&apos;t see your clicks and Reset demo only resets yours. PayPal is simulated in memory, so every step works, including offers, refunds and PayPal&apos;s ruling. The AI investigations are real Gemini runs, replayed from a saved copy to stay within the free tier (Re-run calls the model live).
          {data.sandboxAvailable ? " Switch to Live PayPal sandbox to see real sandbox disputes." : " Set sandbox credentials to run against the PayPal sandbox."}
        </p>
      ) : data?.mode === "sandbox" ? (
        <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-muted">
          Live PayPal sandbox: disputes come from real sandbox buyers through the PayPal Agent Toolkit. The sandbox opens every dispute as a chargeback, where PayPal allows no offers, and refunds need a seller balance, so use the Simulator for those steps.
          {data.viewOnly ? " On the hosted demo the live sandbox is view-only, because every visitor shares the same PayPal account." : ""}
        </p>
      ) : null}
      {error ? <p className="rounded-md border border-danger px-3 py-2 text-sm text-danger">{error}</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Money at risk" value={s ? money(s.at_risk) : "-"} sub={s ? `${s.open} open dispute${s.open === 1 ? "" : "s"}` : undefined} />
        <Kpi
          label="Due within 3 days"
          value={s ? String(s.due_soon) : "-"}
          sub={s?.due_soon ? `${money(s.due_soon_amount)} at stake` : "Nothing urgent"}
          danger={Boolean(s?.due_soon)}
        />
        <Kpi label="Money protected" value={s ? money(s.kept) : "-"} accent sub={s?.rulings ? `Won ${s.won} of ${s.rulings} PayPal ruling${s.rulings === 1 ? "" : "s"}` : "No PayPal rulings yet"} />
        <Kpi
          label="Hours saved"
          value={s ? `${s.hours_saved}h` : "-"}
          sub={s ? `Est. 45 min of manual work per dispute` : undefined}
        />
        <Kpi label="Handled by autopilot" value={s ? `${s.autopilot} of ${s.answered}` : "-"} sub="Responses sent without you" />
      </div>

      <AutopilotPanel cases={data?.cases ?? []} mode={data?.mode} viewOnly={Boolean(data?.viewOnly)} />

      <IncidentsPanel mode={data?.mode} refreshKey={(data?.cases ?? []).map((c) => c.updated_at).join("|")} />

      {data?.mode === "mock" ? <ShieldPanel key={data.cases.length ? "on" : "reset"} viewOnly={Boolean(data.viewOnly)} /> : null}

      <InboxCharts shown={shown} activeClaim={claim} onClaim={filterClaim} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search buyer, item, claim or status"
          aria-label="Search disputes"
          className="w-full max-w-sm rounded-md border border-line bg-panel px-3 py-2 text-sm"
        />
        <button onClick={exportCsv} disabled={!data?.cases.length} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">
          Export outcomes (CSV)
        </button>
      </div>

      <div className="h-[480px]">
        <AgGridReact<Row>
          ref={grid}
          theme={gridTheme}
          rowHeight={64}
          rowData={rows}
          context={context}
          isFullWidthRow={(p) => isDetail(p.rowNode)}
          fullWidthCellRenderer={DetailRow}
          getRowHeight={(p) => (isDetail(p.node) ? 132 : undefined)}
          // Keep each detail row right under its case, whatever the sort.
          postSortRows={(p) => {
            const details = new Map<string, IRowNode<Row>>();
            for (const n of p.nodes) if (n.data?.detail) details.set(n.data.id, n);
            if (!details.size) return;
            const ordered = p.nodes.filter((n) => !n.data?.detail).flatMap((n) => {
              const d = n.data && details.get(`${n.data.id}:detail`);
              return d ? [n, d] : [n];
            });
            p.nodes.splice(0, p.nodes.length, ...ordered);
          }}
          onGridReady={(e) => restoreColumns(e.api)}
          onColumnMoved={(e) => e.finished && saveColumns(e.api)}
          onColumnResized={(e) => e.finished && saveColumns(e.api)}
          onSortChanged={(e) => saveColumns(e.api)}
          columnDefs={cols}
          quickFilterText={search}
          // The id changes with the numbers so AG Grid redraws the pinned row.
          pinnedBottomRowData={totals ? [{ id: `totals-${JSON.stringify(totals)}`, totals } as Row] : []}
          getRowId={(p) => p.data.id}
          // The chevron and the detail row's own link handle their clicks; AG Grid still reports them as row clicks.
          onRowClicked={(e) => {
            const fromControl = (e.event?.target as HTMLElement | null)?.closest("button, a");
            if (e.data && !e.node.rowPinned && !e.data.detail && !fromControl) router.push(`/cases/${e.data.id}`);
          }}
          getRowClass={(p) => (p.node.rowPinned ? "font-medium" : isDetail(p.node) ? undefined : "cursor-pointer")}
          defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" } }}
          onRowDataUpdated={(e) => refreshTotals(e.api)}
          onFilterChanged={(e) => {
            refreshTotals(e.api);
            const m = e.api.getColumnFilterModel("claim") as { type?: string; filter?: string } | null;
            setClaim(m?.type === "equals" ? m.filter ?? null : null);
          }}
          overlayNoRowsTemplate="No disputes. File a test dispute to try the flow."
          suppressCellFocus
        />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent, danger }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular" style={accent ? { color: "var(--accent)" } : danger ? { color: "var(--danger)" } : undefined}>{value}</div>
      {sub ? <div className="text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
