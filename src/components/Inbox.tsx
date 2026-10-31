"use client";

import type { ColDef, ColumnState, GridApi, ICellRendererParams, IRowNode } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseRecord } from "@/lib/types";
import { AlertsFeed } from "./AutopilotPanel";
import { useCases } from "./CasesProvider";
import WelcomeTour from "./WelcomeTour";
import Link from "next/link";
import { daysLeft, DECISION_COLOR, DECISION_LABEL, money, priorityOf, REASON_LABEL, statusLabel } from "./format";
import { gridTheme } from "./grid";
import { Badge, BUTTON, Card, Kpi } from "./ui";


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
    <Badge tone={p.label === "Urgent" ? "bad" : "warn"}>{p.label}</Badge>
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

// The one thing the seller should do next on this dispute.
function NextStepCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  const go = (label: string, primary = false) => (
    <Link href={`/cases/${data.id}`} className={primary ? BUTTON.primary : BUTTON.secondary}>
      {label}
    </Link>
  );
  if (data.outcome) return go("View");
  if (data.status === "ANALYZING") return <span className="text-xs text-muted">Agent working...</span>;
  if (data.submitted) return go("Track");
  if (data.status === "READY") return go("Review", true);
  if (data.status === "ERROR") return go("Retry", true);
  return go("Investigate", true);
}

function AgentCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  const r = data.recommendation;
  const decided = data.submitted?.decision ?? r?.decision;
  return (
    <div className="flex h-full items-center gap-3">
      {data.submitted?.by === "autopilot" ? (
        <Badge tone="info" title={data.autopilot?.reason}>Autopilot</Badge>
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
  const { data, error, rules } = useCases();
  const [search, setSearch] = useState("");
  const [totals, setTotals] = useState<Totals | null>(null);
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
    // Only update on a real change, so setting the pinned row can't loop back here.
    setTotals((cur) => (cur && JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  }, []);


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
        minWidth: 190,
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
        minWidth: 120,
        valueGetter: (p) => p.data?.dispute && REASON_LABEL[p.data.dispute.reason],
        filter: "agTextColumnFilter",
        floatingFilter: true,
      },
      {
        colId: "stage",
        headerName: "Stage",
        flex: 0.7,
        minWidth: 100,
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
        minWidth: 100,
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
        minWidth: 96,
        valueGetter: (p) => (p.data?.dispute ? priorityOf(p.data).score : undefined),
        sort: "desc",
      },
      {
        colId: "due",
        headerName: "Due in",
        cellRenderer: DueCell,
        cellRendererSelector: pinned(blank),
        flex: 0.8,
        minWidth: 110,
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
        minWidth: 220,
        valueGetter: (p) => (p.data?.dispute ? statusLabel(p.data) : undefined),
      },
      {
        colId: "next",
        headerName: "Next step",
        width: 120,
        minWidth: 120,
        sortable: false,
        cellRenderer: NextStepCell,
        cellRendererSelector: pinned(blank),
      },
      // Export-only columns for the outcomes CSV (Insights exports the same data).
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
  const auto = rules?.enabled;

  return (
    <div className="space-y-5">
      <WelcomeTour />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Disputes</h1>
        <p className="text-sm text-muted">The agent investigates each dispute as PayPal reports it and ranks them by money and deadline. Nothing goes to PayPal without your approval, except what your autopilot rules allow.</p>
      </div>
      {data ? (
        <p className="text-xs text-muted">
          {data.mode === "mock"
            ? "Simulator: your own private copy of the demo with simulated PayPal. AI investigations are real Gemini runs, replayed to stay within the free tier."
            : `Live PayPal sandbox: real sandbox disputes through the PayPal Agent Toolkit.${data.viewOnly ? " View-only on the hosted demo." : ""}`}
        </p>
      ) : null}
      {error ? <p className="rounded-md border border-danger px-3 py-2 text-sm text-danger">{error}</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-tour="kpis">
        <Kpi label="Money at risk" value={s ? money(s.at_risk) : "-"} sub={s ? `${s.open} open dispute${s.open === 1 ? "" : "s"}` : undefined} />
        <Kpi label="Due within 3 days" value={s ? String(s.due_soon) : "-"} sub={s?.due_soon ? `${money(s.due_soon_amount)} at stake` : "Nothing urgent"} tone={s?.due_soon ? "bad" : undefined} />
        <Kpi label="Money protected" value={s ? money(s.kept) : "-"} tone="good" sub={s?.rulings ? `Won ${s.won} of ${s.rulings} PayPal ruling${s.rulings === 1 ? "" : "s"}` : "No PayPal rulings yet"} />
        <Kpi label="Autopilot" value={rules ? (auto ? "On" : "Off") : "-"} tone={auto ? "good" : "neutral"} sub={s ? `Handled ${s.autopilot} of ${s.answered} responses` : undefined} />
      </div>

      <Card title="Latest alerts" subtitle="PayPal webhooks and what autopilot did with them." right={<Link href="/insights" className="text-xs text-accent underline">Full history</Link>}>
        <AlertsFeed cases={data?.cases ?? []} mode={data?.mode} limit={3} />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search buyer, item, claim or status"
          aria-label="Search disputes"
          className="w-full max-w-sm rounded-md border border-line bg-panel px-3 py-2 text-sm"
        />
        <span className="text-xs text-muted">Click ▶ for the agent&apos;s reasoning, or a row to open the dispute.</span>
      </div>

      <div data-tour="grid">
        <AgGridReact<Row>
          ref={grid}
          theme={gridTheme}
          rowHeight={64}
          domLayout="autoHeight"
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
          onFilterChanged={(e) => refreshTotals(e.api)}
          overlayNoRowsTemplate="No disputes yet. Open Simulator tools to file a test dispute."
          suppressCellFocus
        />
      </div>
    </div>
  );
}

