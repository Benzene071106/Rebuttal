"use client";

import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import type { CaseRecord } from "@/lib/types";
import { AlertsFeed } from "./AutopilotPanel";
import { useCases } from "./CasesProvider";
import { DECISION_LABEL, money, REASON_LABEL, statusLabel } from "./format";
import { gridTheme } from "./grid";
import { useGridEnterprise } from "./gridEnterprise";
import IncidentsPanel from "./IncidentsPanel";
import InboxCharts from "./InboxCharts";
import { Badge, BUTTON, Card, Kpi } from "./ui";

const decisionOf = (c?: CaseRecord) => {
  const d = c?.submitted?.decision ?? c?.recommendation?.decision;
  return d ? DECISION_LABEL[d] : "";
};

function ResultCell({ data }: ICellRendererParams<CaseRecord>) {
  if (!data) return null;
  const o = data.outcome;
  if (!o) return <span className="text-sm text-muted">{statusLabel(data)}</span>;
  return <Badge tone={o.amount_kept > 0 ? "good" : "bad"}>{o.result === "WON" ? "Won" : o.result === "SETTLED" ? "Settled" : o.result === "REFUNDED" ? "Refunded" : "Lost"}</Badge>;
}

const COLS: ColDef<CaseRecord>[] = [
  { colId: "id", headerName: "Dispute ID", hide: true, valueGetter: (p) => p.data?.id },
  { colId: "buyer", headerName: "Buyer", flex: 1.2, minWidth: 140, valueGetter: (p) => p.data?.dispute.disputed_transactions[0]?.buyer?.name, tooltipValueGetter: (p) => p.data?.dispute.disputed_transactions[0]?.items?.[0]?.item_description, filter: "agTextColumnFilter" },
  { colId: "claim", headerName: "Claim", flex: 1, minWidth: 120, valueGetter: (p) => p.data && REASON_LABEL[p.data.dispute.reason], filter: "agTextColumnFilter", floatingFilter: true },
  { colId: "amount", headerName: "Amount", width: 100, type: "rightAligned", valueGetter: (p) => Number(p.data?.dispute.dispute_amount.value ?? 0), valueFormatter: (p) => money(p.value), cellClass: "tabular", filter: "agNumberColumnFilter" },
  { colId: "decision", headerName: "Decision", width: 120, valueGetter: (p) => decisionOf(p.data), filter: "agTextColumnFilter", floatingFilter: true },
  { colId: "by", headerName: "Answered by", width: 120, valueGetter: (p) => (p.data?.submitted ? (p.data.submitted.by === "autopilot" ? "Autopilot" : "You") : "") },
  { colId: "result", headerName: "Result", width: 120, valueGetter: (p) => p.data?.outcome?.result ?? (p.data ? statusLabel(p.data) : ""), cellRenderer: ResultCell },
  { colId: "kept", headerName: "Kept", width: 100, type: "rightAligned", valueGetter: (p) => p.data?.outcome?.amount_kept ?? 0, valueFormatter: (p) => money(p.value), cellClass: "tabular" },
  {
    colId: "closed",
    headerName: "Closed",
    width: 110,
    valueGetter: (p) => (p.data?.outcome ? new Date(p.data.outcome.at) : null),
    valueFormatter: (p) => (p.node?.group || p.node?.footer ? "" : p.value ? (p.value as Date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Open"),
    filter: "agDateColumnFilter",
    // Compare calendar days, not timestamps.
    filterParams: { comparator: (day: Date, v: Date | null) => (!v ? -1 : new Date(v.getFullYear(), v.getMonth(), v.getDate()).getTime() - day.getTime()) },
    comparator: (a: Date | null, b: Date | null) => (a?.getTime() ?? Infinity) - (b?.getTime() ?? Infinity),
    sort: "desc",
  },
  { colId: "refunded", headerName: "Refunded", width: 110, flex: 0.5, type: "rightAligned", valueGetter: (p) => p.data?.outcome?.amount_lost ?? 0, valueFormatter: (p) => money(p.value), cellClass: "tabular" },
];

type Factor = NonNullable<NonNullable<CaseRecord["recommendation"]>["factors"]>[number];
const FACTOR_COLS: ColDef<Factor>[] = [
  { field: "finding", headerName: "What the agent found", flex: 2, minWidth: 220, wrapText: true, autoHeight: true },
  { field: "favors", headerName: "Favors", width: 110, valueFormatter: (p) => (p.value === "SELLER" ? "You" : "Buyer") },
  { field: "weight", headerName: "Weight", width: 100, valueFormatter: (p) => String(p.value ?? "").toLowerCase() },
  { field: "source", headerName: "PayPal source", width: 190 },
];

// Enterprise only (with AG_GRID_LICENSE_KEY): the ledger groups by claim type with
// totals per group, and each dispute expands into a detail grid of the agent's findings.
function enterpriseCols(cols: ColDef<CaseRecord>[]): ColDef<CaseRecord>[] {
  return cols.map((c) =>
    c.colId === "claim"
      ? { ...c, rowGroup: true, hide: true, enableRowGroup: true }
      : ["amount", "kept", "refunded"].includes(c.colId ?? "")
        ? { ...c, aggFunc: "sum", enableValue: true }
        : ["decision", "by", "result"].includes(c.colId ?? "")
          ? { ...c, enableRowGroup: true }
          : c,
  );
}

// What the agent did: savings, linked charts over an outcomes ledger, the autopilot
// history and the self-healing incident log.
export default function Insights() {
  const router = useRouter();
  const { data } = useCases();
  const grid = useRef<AgGridReact<CaseRecord>>(null);
  const [shown, setShown] = useState<CaseRecord[]>([]);
  const [claim, setClaim] = useState<string | null>(null);
  const s = data?.stats;
  const enterprise = useGridEnterprise();
  const columnDefs = useMemo(() => (enterprise ? enterpriseCols(COLS) : COLS), [enterprise]);
  const enterpriseProps = enterprise
    ? {
        rowGroupPanelShow: "always" as const,
        groupDefaultExpanded: 0,
        autoGroupColumnDef: { headerName: "Claim type", minWidth: 220 },
        grandTotalRow: "bottom" as const,
        suppressAggFuncInHeader: true,
        masterDetail: true,
        isRowMaster: (c: CaseRecord) => Boolean(c?.recommendation?.factors?.length),
        detailRowAutoHeight: true,
        detailCellRendererParams: {
          detailGridOptions: { theme: gridTheme, columnDefs: FACTOR_COLS, domLayout: "autoHeight", defaultColDef: { cellStyle: { display: "flex", alignItems: "center" } } },
          getDetailRowData: (p: { data: CaseRecord; successCallback: (rows: Factor[]) => void }) => p.successCallback(p.data.recommendation?.factors ?? []),
        },
      }
    : {};

  const refresh = useCallback((api: GridApi<CaseRecord>) => {
    const visible: CaseRecord[] = [];
    api.forEachNodeAfterFilter((n) => n.data && visible.push(n.data));
    setShown((cur) => (cur.length === visible.length && cur.every((c, i) => c === visible[i]) ? cur : visible));
    const m = api.getColumnFilterModel("claim") as { type?: string; filter?: string } | null;
    setClaim(m?.type === "equals" ? m.filter ?? null : null);
  }, []);

  // Clicking a bar in the chart filters the ledger's Claim column; clicking it again clears it.
  const filterClaim = useCallback(async (value: string | null) => {
    const api = grid.current?.api;
    if (!api) return;
    await api.setColumnFilterModel("claim", value ? { filterType: "text", type: "equals", filter: value } : null);
    api.onFilterChanged();
  }, []);

  function exportCsv() {
    grid.current?.api.exportDataAsCsv({ fileName: `rebuttal-outcomes-${new Date().toISOString().slice(0, 10)}.csv`, columnKeys: ["id", "buyer", "claim", "amount", "decision", "by", "result", "closed", "kept", "refunded"], processCellCallback: (p) => (p.value instanceof Date ? p.value.toISOString().slice(0, 10) : p.value) });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted">What the agent did for you: money kept, time saved, every autopilot action and every PayPal failure it handled.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Money protected" value={s ? money(s.kept) : "-"} tone="good" sub={s?.rulings ? `Won ${s.won} of ${s.rulings} PayPal ruling${s.rulings === 1 ? "" : "s"}` : "No PayPal rulings yet"} />
        <Kpi label="Hours saved" value={s ? `${s.hours_saved}h` : "-"} sub="Est. 45 min of manual work per dispute" />
        <Kpi label="Handled by autopilot" value={s ? `${s.autopilot} of ${s.answered}` : "-"} sub="Responses sent without you" />
        <Kpi label="Disputes" value={s ? String(data?.cases.length ?? 0) : "-"} sub={s ? `${s.open} still open` : undefined} />
      </div>

      <InboxCharts shown={shown} activeClaim={claim} onClaim={filterClaim} />

      <Card
        title="Outcomes ledger"
        subtitle={`${enterprise ? "Grouped by claim type (drag columns into the bar to regroup); expand a dispute for the agent's findings. " : ""}The charts above follow this grid's filters (try the Closed date filter). Click a row to open it.${data?.cases.some((c) => c.history) ? ` Includes ${data.cases.filter((c) => c.history).length} simulated past disputes from the demo shop.` : ""}`}
        right={<button onClick={exportCsv} disabled={!data?.cases.length} className={BUTTON.secondary}>Export outcomes (CSV)</button>}
      >
        <AgGridReact<CaseRecord>
          ref={grid}
          // Remount when Enterprise switches on, so grouping and master-detail apply cleanly.
          key={enterprise ? "enterprise" : "community"}
          {...enterpriseProps}
          theme={gridTheme}
          rowData={data?.cases ?? []}
          columnDefs={columnDefs}
          domLayout="autoHeight"
          rowHeight={48}
          pagination
          paginationPageSize={10}
          paginationPageSizeSelector={[10, 25, 50, 100]}
          tooltipShowDelay={400}
          getRowId={(p) => p.data.id}
          onRowClicked={(e) => {
            // The master-detail chevron is a control, not a request to open the dispute.
            const fromControl = (e.event?.target as HTMLElement | null)?.closest(".ag-group-contracted, .ag-group-expanded, .ag-details-row");
            if (e.data && !fromControl) router.push(`/cases/${e.data.id}`);
          }}
          getRowClass={() => "cursor-pointer"}
          defaultColDef={{ cellStyle: { display: "flex", alignItems: "center" }, sortable: true }}
          onRowDataUpdated={(e) => refresh(e.api)}
          onFilterChanged={(e) => refresh(e.api)}
          overlayNoRowsTemplate="No disputes yet."
          suppressCellFocus
        />
      </Card>

      <IncidentsPanel mode={data?.mode} refreshKey={(data?.cases ?? []).map((c) => c.updated_at).join("|")} />

      <Card title="Autopilot history" subtitle="PayPal webhooks and what the agent did, newest first.">
        <AlertsFeed cases={data?.cases ?? []} mode={data?.mode} limit={20} />
      </Card>
    </div>
  );
}
