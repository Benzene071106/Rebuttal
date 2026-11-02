"use client";

import type { ColDef } from "ag-grid-community";
import { useEffect, useState } from "react";

// True on phone-width screens. False during server render and the first paint.
export function usePhone(maxWidth = 640): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setPhone(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [maxWidth]);
  return phone;
}

// On a phone the grids keep only the columns a seller needs at a glance; the rest are
// hidden (still in the CSV export and the row detail), and an action column can be
// pinned to the right edge so it never scrolls out of reach.
export function forPhone<T>(cols: ColDef<T>[], phone: boolean, hide: string[], pinRight: string[] = []): ColDef<T>[] {
  return cols.map((c) => {
    const id = c.colId ?? String(c.field ?? "");
    if (hide.includes(id)) return { ...c, hide: phone };
    if (pinRight.includes(id)) return { ...c, pinned: phone ? "right" : null };
    return c;
  });
}
