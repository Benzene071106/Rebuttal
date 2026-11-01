"use client";

import { ModuleRegistry } from "ag-grid-community";
import { useEffect, useState } from "react";

// AG Grid Enterprise is optional. With no AG_GRID_LICENSE_KEY on the server, nothing
// here downloads it and every grid stays Community, with no watermark. With a key, the
// Enterprise bundle is loaded once, licensed, and row grouping and master-detail switch
// on for the grids that use them.
let ready: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  ready ??= fetch("/api/grid-config", { cache: "no-store" })
    .then((r) => r.json())
    .then(async (cfg: { enterprise: boolean; key?: string }) => {
      if (!cfg.enterprise || !cfg.key) return false;
      const ent = await import("ag-grid-enterprise");
      ent.LicenseManager.setLicenseKey(cfg.key);
      ModuleRegistry.registerModules([ent.RowGroupingModule, ent.RowGroupingPanelModule, ent.MasterDetailModule]);
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
