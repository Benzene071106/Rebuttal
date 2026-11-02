"use client";

import { ModuleRegistry } from "ag-grid-community";
import { useEffect, useState } from "react";

// AG Grid Enterprise is optional. With no AG_GRID_LICENSE_KEY on the server, nothing
// here downloads it and every grid stays Community, with no watermark. With a key, the
// Enterprise bundle (and AG Charts Enterprise for integrated charts) is loaded once,
// licensed, and the grids switch on: row grouping and pivoting, master-detail, set
// filters, the side bar's tool panels, the status bar, cell selection with integrated
// and cross-filter charts, context menus and Excel export.
let ready: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  ready ??= fetch("/api/grid-config", { cache: "no-store" })
    .then((r) => r.json())
    .then(async (cfg: { enterprise: boolean; key?: string }) => {
      if (!cfg.enterprise || !cfg.key) return false;
      const [ent, charts] = await Promise.all([import("ag-grid-enterprise"), import("ag-charts-enterprise")]);
      ent.LicenseManager.setLicenseKey(cfg.key);
      ModuleRegistry.registerModules([
        ent.RowGroupingModule,
        ent.RowGroupingPanelModule,
        ent.PivotModule,
        ent.MasterDetailModule,
        ent.SetFilterModule,
        ent.SideBarModule,
        ent.ColumnsToolPanelModule,
        ent.FiltersToolPanelModule,
        ent.StatusBarModule,
        ent.CellSelectionModule,
        ent.ClipboardModule,
        ent.ContextMenuModule,
        ent.ColumnMenuModule,
        ent.ExcelExportModule,
        ent.IntegratedChartsModule.with(charts.AgChartsEnterpriseModule),
      ]);
      return true;
    })
    .catch(() => false);
  return ready;
}

export function useGridEnterprise(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    load().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}
