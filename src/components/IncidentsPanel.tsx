"use client";

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Incident } from "@/lib/types";
import { DECISION_LABEL, money } from "./format";
import { gridTheme } from "./grid";

type Row = Incident & { detail?: true };
type Fault = "OUTAGE" | "TOKEN_EXPIRED" | "INSUFFICIENT_FUNDS";
const FAULTS: Array<[Fault, string]> = [
  ["OUTAGE", "PayPal outage (503, twice)"],
  ["TOKEN_EXPIRED", "Expired PayPal token (401)"],
  ["INSUFFICIENT_FUNDS", "Refund refused: insufficient funds (422)"],
];

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ResultCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  const healed = data.result === "HEALED";
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: healed ? "var(--fight)" : "var(--offer)", border: "1px solid currentColor" }}>
      {healed ? "Self-healed" : data.plan === "PROPOSE_ALTERNATIVE" ? "Alternative proposed" : "Waiting for you"}
    </span>
  );
}

function ErrorCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden leading-tight">
      <span className="truncate font-mono text-xs font-semibold">{data.paypal.status ?? "-"} {data.paypal.name}</span>
      {data.paypal.debug_id ? <span className="truncate font-mono text-xs text-muted">debug_id {data.paypal.debug_id}</span> : null}
    </div>
  );
}

function ExpandCell({ data, context }: ICellRendererParams<Row>) {
  if (!data) return null;
  const open = (context as { open: string | null }).open === data.id;
  return <span className="inline-block text-muted transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} aria-hidden>▶</span>;
}

const COLS: ColDef<Row>[] = [
  { colId: "expand", headerName: "", width: 44, maxWidth: 44, sortable: false, resizable: false, cellRenderer: ExpandCell },
  { field: "at", headerName: "When", width: 110, valueFormatter: (p) => time(p.value), sort: "desc", cellClass: "text-muted tabular" },
  { colId: "dispute", headerName: "Dispute", flex: 1, minWidth: 150, valueGetter: (p) => `${p.data?.buyer ?? ""} ${p.data?.invoice ? `(${p.data.invoice})` : ""}`, cellRenderer: (p: ICellRendererParams<Row>) => <span className="block w-full min-w-0 truncate">{p.value}</span> },
  { colId: "action", headerName: "Action", width: 150, valueGetter: (p) => (p.data ? `${DECISION_LABEL[p.data.action]} ${money(p.data.amount)}` : ""), cellRenderer: (p: ICellRendererParams<Row>) => <span className="block w-full min-w-0 truncate">{p.value}</span> },
  { colId: "error", headerName: "PayPal said", flex: 1.2, minWidth: 190, valueGetter: (p) => p.data?.paypal.name, cellRenderer: ErrorCell, filter: "agTextColumnFilter" },
  { colId: "did", headerName: "What the agent did", flex: 2, minWidth: 240, valueGetter: (p) => p.data?.diagnosis, tooltipValueGetter: (p) => p.value, cellRenderer: (p: ICellRendererParams<Row>) => <span className="block w-full min-w-0 truncate">{p.value}</span> },
  { colId: "result", headerName: "Result", width: 170, valueGetter: (p) => p.data?.result, cellRenderer: ResultCell, filter: "agTextColumnFilter" },
];

// The full story of one incident: every attempt, the diagnosis and what the seller should do.
function Detail({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  return (
    <div className="grid h-full gap-4 overflow-auto whitespace-normal border-l-4 bg-bg px-6 py-3 text-sm leading-normal md:grid-cols-2" style={{ borderColor: data.result === "HEALED" ? "var(--fight)" : "var(--offer)" }}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Attempts</h3>
        <ol className="mt-1 space-y-0.5">
          {data.attempts.map((a, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-semibold" style={{ color: a.ok ? "var(--fight)" : "var(--danger)" }}>{a.ok ? "✓" : "✗"}</span>
              <span>{a.what}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 break-all font-mono text-xs text-muted">{data.paypal.message.slice(0, 260)}</p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Diagnosis {data.by === "model" ? `(${data.model ?? "AI"})` : "(rules)"}</h3>
        <p className="mt-1">{data.diagnosis}</p>
        {data.alternative ? (
          <p className="mt-1">
            <span className="font-semibold">Proposed instead:</span> {data.alternative.decision === "OFFER" ? `a ${money(data.alternative.amount)} partial refund` : "fight with evidence"}. {data.alternative.why} It waits for your approval.
          </p>
        ) : null}
        {data.seller_steps.length ? (
          <ol className="mt-1 list-decimal pl-5">
            {data.seller_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

// Self-healing log: PayPal calls that failed while Rebuttal acted, and what the agent did.
export default function IncidentsPanel({ mode, refreshKey }: { mode?: "mock" | "sandbox"; refreshKey: string }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [armed, setArmed] = useState<Fault | null>(null);
  const [pick, setPick] = useState<Fault>("INSUFFICIENT_FUNDS");
  const [open, setOpen] = useState<string | null>(null);
  const grid = useRef<AgGridReact<Row>>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/incidents", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setIncidents(json.incidents);
    setArmed(json.armed);
  }, []);
  // Reload whenever the inbox's cases change (the inbox polls PayPal).
  useEffect(() => {
    load();
  }, [load, refreshKey, mode]);
  useEffect(() => {
    grid.current?.api?.refreshCells({ columns: ["expand"], force: true });
  }, [open]);

  async function arm(kind: Fault | null) {
    const res = await fetch("/api/demo/fault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    if (res.ok) setArmed((await res.json()).armed);
  }

  if (mode !== "mock" && !incidents.length) return null;
  const healed = incidents.filter((i) => i.result === "HEALED").length;
  const rows: Row[] = incidents.flatMap((i) => (open === i.id ? [i, { ...i, detail: true as const }] : [i]));

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Self-healing: PayPal incidents</h2>
          <p className="text-xs text-muted">When a PayPal call fails, the agent reads PayPal&apos;s error and recovers: it retries outages, refreshes an expired sign-in, and explains anything else. It never widens your limits.</p>
        </div>
        {incidents.length ? <span className="text-xs text-muted tabular">{healed} of {incidents.length} self-healed</span> : null}
      </div>

      {mode === "mock" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Test it:</span>
          <select value={pick} onChange={(e) => setPick(e.target.value as Fault)} aria-label="PayPal fault to inject" className="rounded-md border border-line bg-panel px-2 py-1.5">
            {FAULTS.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <button onClick={() => arm(pick)} className="rounded-md border border-line px-3 py-1.5 hover:border-accent">Break PayPal&apos;s next call</button>
          {armed ? (
            <span className="text-xs" style={{ color: "var(--offer)" }}>
              Armed: {FAULTS.find(([k]) => k === armed)?.[1]}. Approve a response or simulate a dispute.{" "}
              <button onClick={() => arm(null)} className="underline">Cancel</button>
            </span>
          ) : null}
        </div>
      ) : null}

      {incidents.length ? (
        <div className="mt-3">
          <AgGridReact<Row>
            ref={grid}
            theme={gridTheme}
            rowData={rows}
            columnDefs={COLS}
            context={{ open }}
            domLayout="autoHeight"
            getRowId={(p) => `${p.data.id}${p.data.detail ? ":detail" : ""}`}
            isFullWidthRow={(p) => Boolean(p.rowNode.data?.detail)}
            fullWidthCellRenderer={Detail}
            getRowHeight={(p) => (p.data?.detail ? 200 : 56)}
            postSortRows={(p) => {
              const ordered = p.nodes.filter((n) => !n.data?.detail).flatMap((n) => {
                const d = p.nodes.find((x) => x.data?.detail && x.data.id === n.data?.id);
                return d ? [n, d] : [n];
              });
              p.nodes.splice(0, p.nodes.length, ...ordered);
            }}
            onRowClicked={(e) => e.data && !e.data.detail && setOpen(open === e.data.id ? null : e.data.id)}
            getRowClass={(p) => (p.data?.detail ? undefined : "cursor-pointer")}
            defaultColDef={{ cellStyle: { display: "flex", alignItems: "center", overflow: "hidden" }, sortable: true }}
            enableCellTextSelection
            suppressCellFocus
          />
        </div>
      ) : null}
    </section>
  );
}
