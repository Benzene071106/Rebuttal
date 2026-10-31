"use client";

import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { CaseRecord } from "@/lib/types";
import { AlertsFeed } from "./AutopilotPanel";
import { useCases } from "./CasesProvider";
import { DECISION_LABEL, money, REASON_LABEL, statusLabel } from "./format";
import { gridTheme } from "./grid";
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
  { colId: "buyer", headerName: "Buyer", flex: 1.2, minWidth: 150, valueGetter: (p) => p.data?.dispute.disputed_transactions[0]?.buyer?.name },
  { colId: "claim", headerName: "Claim", flex: 1, minWidth: 130, valueGetter: (p) => p.data && REASON_LABEL[p.data.dispute.reason], filter: "agTextColumnFilter", floatingFilter: true },
  { colId: "amount", headerName: "Amount", width: 110, type: "rightAligned", valueGetter: (p) => Number(p.data?.dispute.dispute_amount.value ?? 0), valueFormatter: (p) => money(p.value), cellClass: "tabular" },
  { colId: "decision", headerName: "Decision", width: 130, valueGetter: (p) => decisionOf(p.data), filter: "agTextColumnFilter", floatingFilter: true },
  { colId: "by", headerName: "Answered by", width: 130, valueGetter: (p) => (p.data?.submitted ? (p.data.submitted.by === "autopilot" ? "Autopilot" : "You") : "") },
  { colId: "result", headerName: "Result", width: 140, valueGetter: (p) => p.data?.outcome?.result ?? (p.data ? statusLabel(p.data) : ""), cellRenderer: ResultCell },
  { colId: "kept", headerName: "Kept", width: 110, type: "rightAligned", valueGetter: (p) => p.data?.outcome?.amount_kept ?? 0, valueFormatter: (p) => money(p.value), cellClass: "tabular" },
  { colId: "refunded", headerName: "Refunded", width: 110, type: "rightAligned", valueGetter: (p) => p.data?.outcome?.amount_lost ?? 0, valueFormatter: (p) => money(p.value), cellClass: "tabular" },
];

// What the agent did: savings, linked charts over an outcomes ledger, the autopilot
// history and the self-healing incident log.
export default function Insights() {
  const router = useRouter();
  const { data } = useCases();
  const grid = useRef<AgGridReact<CaseRecord>>(null);
  const [shown, setShown] = useState<CaseRecord[]>([]);
  const [claim, setClaim] = useState<string | null>(null);
  const s = data?.stats;

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
    grid.current?.api.exportDataAsCsv({ fileName: `rebuttal-outcomes-${new Date().toISOString().slice(0, 10)}.csv`, columnKeys: ["id", "buyer", "claim", "amount", "decision", "by", "result", "kept", "refunded"] });
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
        subtitle="The charts above follow this grid's filters. Click a row to open the dispute."
        right={<button onClick={exportCsv} disabled={!data?.cases.length} className={BUTTON.secondary}>Export outcomes (CSV)</button>}
      >
        <AgGridReact<CaseRecord>
          ref={grid}
          theme={gridTheme}
          rowData={data?.cases ?? []}
          columnDefs={COLS}
          domLayout="autoHeight"
          rowHeight={48}
          getRowId={(p) => p.data.id}
          onRowClicked={(e) => e.data && router.push(`/cases/${e.data.id}`)}
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
