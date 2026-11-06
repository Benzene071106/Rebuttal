"use client";

import type { ColDef, GridApi } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { money } from "./format";
import { gridTheme } from "./grid";
import { useGridEnterprise } from "./gridEnterprise";
import { BUTTON, Card } from "./ui";

type Row = { id: number; buyer: string; claim: string; amount: number; decision: string; by: string; result: string; kept: number; refunded: number; closed: Date };

const CLAIMS = ["Not received", "Not as described", "Unauthorized", "Credit not processed", "Duplicate"];
const FIRST = ["Dana", "Priya", "Marco", "Aiko", "Sam", "Lena", "Omar", "Grace", "Tom", "Zara", "Ravi", "Nina"];
const LAST = ["Whitfield", "Raman", "Rossi", "Tanaka", "Okafor", "Novak", "Haddad", "Kim", "Berg", "Silva"];

// A fixed-seed generator, so every visitor gets the same 100,000 simulated disputes.
function rows(n: number): Row[] {
  let s = 42;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const start = Date.UTC(2025, 0, 1);
  const out: Row[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const claim = CLAIMS[Math.floor(rnd() * rnd() * CLAIMS.length)];
    const amount = Math.round((8 + rnd() * rnd() * 600) * 100) / 100;
    const r = rnd();
    const decision = r < 0.45 ? "Fight" : r < 0.7 ? "Partial refund" : "Refund";
    const won = decision === "Fight" ? rnd() < 0.72 : false;
    const settledKeep = decision === "Partial refund" ? Math.round(amount * (0.5 + rnd() * 0.3) * 100) / 100 : 0;
    const kept = decision === "Fight" ? (won ? amount : 0) : settledKeep;
    out[i] = {
      id: i + 1,
      buyer: `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`,
      claim,
      amount,
      decision,
      by: rnd() < 0.4 ? "Autopilot" : "Seller",
      result: decision === "Fight" ? (won ? "Won" : "Lost") : decision === "Partial refund" ? "Settled" : "Refunded",
      kept,
      refunded: Math.round((amount - kept) * 100) / 100,
      closed: new Date(start + Math.floor(rnd() * 670) * 86_400_000),
    };
  }
  return out;
}

const COLS: ColDef<Row>[] = [
  { field: "id", headerName: "#", width: 90, filter: "agNumberColumnFilter" },
  { field: "buyer", headerName: "Buyer", flex: 1, minWidth: 140, filter: "agTextColumnFilter" },
  { field: "claim", headerName: "Claim", flex: 1, minWidth: 140, filter: "agTextColumnFilter" },
  { field: "amount", headerName: "Amount", width: 140, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : money(p.value)), filter: "agNumberColumnFilter" },
  { field: "decision", headerName: "Decision", width: 130, filter: "agTextColumnFilter" },
  { field: "by", headerName: "Answered by", width: 120 },
  { field: "result", headerName: "Result", width: 110, filter: "agTextColumnFilter" },
  { field: "kept", headerName: "Kept", width: 130, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : money(p.value)) },
  { field: "refunded", headerName: "Refunded", width: 130, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : money(p.value)) },
  { field: "closed", headerName: "Closed", width: 120, valueFormatter: (p) => (p.value ? (p.value as Date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""), filter: "agDateColumnFilter" },
];

// Enterprise: group by claim with sums, set filters and the side bar, like the real ledger.
const ENTERPRISE_COLS: ColDef<Row>[] = COLS.map((c) =>
  c.field === "claim"
    ? { ...c, rowGroup: true, hide: true, enableRowGroup: true, filter: "agSetColumnFilter" }
    : ["decision", "by", "result"].includes(c.field ?? "")
      ? { ...c, enableRowGroup: true, enablePivot: true, filter: "agSetColumnFilter" }
      : ["amount", "kept", "refunded"].includes(c.field ?? "")
        ? { ...c, aggFunc: "sum", enableValue: true }
        : c,
);

type Timing = { generate: number; render?: number; last?: { what: string; ms: number } };

// A scale check for the grid: 100,000 simulated disputes (a shop's lifetime and then
// some) in one AG Grid, with the time each step took shown, so anyone can see that
// sorting, filtering and grouping stay instant at that size.
export default function ScaleTest() {
  const enterprise = useGridEnterprise();
  const [data, setData] = useState<Row[] | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const t0 = useRef(0);
  const api = useRef<GridApi<Row> | null>(null);

  function load() {
    const s = performance.now();
    const r = rows(100_000);
    const generate = Math.round(performance.now() - s);
    t0.current = performance.now();
    setTiming({ generate });
    setData(r);
  }

  // Time a grid operation from the click to the next painted frame.
  const timed = useCallback((what: string, run: (a: GridApi<Row>) => void) => {
    const a = api.current;
    if (!a) return;
    const s = performance.now();
    run(a);
    requestAnimationFrame(() => setTiming((t) => (t ? { ...t, last: { what, ms: Math.round(performance.now() - s) } } : t)));
  }, []);

  const enterpriseProps = useMemo(
    () =>
      enterprise
        ? {
            rowGroupPanelShow: "always" as const,
            autoGroupColumnDef: { headerName: "Group", minWidth: 220 },
            grandTotalRow: "bottom" as const,
            suppressAggFuncInHeader: true,
            sideBar: { toolPanels: ["columns", "filters"] },
            statusBar: { statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" as const }] },
          }
        : {},
    [enterprise],
  );

  return (
    <Card
      title="Scale check: 100,000 disputes"
      subtitle="Simulated disputes (fixed seed, not your shop's data) to show the grid stays fast at scale. Load them, then sort, filter or group and watch the timings."
      right={
        data ? (
          <div className="flex flex-wrap gap-2">
            <button className={BUTTON.secondary} onClick={() => timed("Sort by amount", (a) => a.applyColumnState({ state: [{ colId: "amount", sort: "desc" }], defaultState: { sort: null } }))}>Sort by amount</button>
            <button className={BUTTON.secondary} onClick={() => timed('Search "Raman"', (a) => a.setGridOption("quickFilterText", "Raman"))}>Search &quot;Raman&quot;</button>
            {enterprise ? (
              <button className={BUTTON.secondary} onClick={() => timed("Group by result", (a) => a.setRowGroupColumns(["result"]))}>Group by result</button>
            ) : null}
            <button className={BUTTON.ghost} onClick={() => timed("Clear", (a) => { a.setGridOption("quickFilterText", ""); a.setFilterModel(null); a.applyColumnState({ defaultState: { sort: null } }); if (enterprise) a.setRowGroupColumns(["claim"]); })}>Clear</button>
            <button className={BUTTON.ghost} onClick={() => { setData(null); setTiming(null); }}>Unload</button>
          </div>
        ) : (
          <button className={BUTTON.secondary} onClick={load}>Load 100,000 disputes</button>
        )
      }
    >
      {timing ? (
        <p className="mb-3 text-sm tabular" aria-live="polite">
          Generated in <b>{timing.generate} ms</b>
          {timing.render !== undefined ? <> · first rows on screen in <b>{timing.render} ms</b></> : " · loading into the grid…"}
          {timing.last ? <> · {timing.last.what}: <b>{timing.last.ms} ms</b></> : null}
        </p>
      ) : null}
      {data ? (
        <div style={{ height: 480 }}>
          <AgGridReact<Row>
            key={enterprise ? "enterprise" : "community"}
            {...enterpriseProps}
            theme={gridTheme}
            rowData={data}
            columnDefs={enterprise ? ENTERPRISE_COLS : COLS}
            getRowId={(p) => String(p.data.id)}
            defaultColDef={{ sortable: true, cellStyle: { display: "flex", alignItems: "center" } }}
            onGridReady={(e) => (api.current = e.api)}
            onFirstDataRendered={() => setTiming((t) => (t ? { ...t, render: Math.round(performance.now() - t0.current) } : t))}
            suppressCellFocus
          />
        </div>
      ) : null}
    </Card>
  );
}
