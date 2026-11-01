"use client";

import { AllCommunityModule, checkboxStyleDefault, iconSetQuartzBold, inputStyleBordered, ModuleRegistry, themeQuartz } from "ag-grid-community";

// AG Grid Community, registered once for every grid in the app.
ModuleRegistry.registerModules([AllCommunityModule]);

// The Rebuttal grid theme, built with the AG Grid Theming API (no grid CSS overrides).
// Every color is one of the app's CSS variables, so all six grids follow light and dark
// mode with the rest of the app. Quartz is the base; the parts swap in bold icons,
// bordered inputs for the inline editors and filters, and the default checkbox style
// recolored for row selection.
export const gridTheme = themeQuartz
  .withPart(iconSetQuartzBold)
  .withPart(inputStyleBordered)
  .withPart(checkboxStyleDefault)
  .withParams({
    // Surfaces and text
    backgroundColor: "var(--panel)",
    foregroundColor: "var(--ink)",
    chromeBackgroundColor: "var(--bg)",
    headerBackgroundColor: "var(--bg)",
    headerTextColor: "var(--muted)",
    headerCellHoverBackgroundColor: "var(--accent-soft)",
    borderColor: "var(--line)",
    browserColorScheme: "inherit",
    // Brand: Rebuttal green for focus, selection, checkboxes and resize handles
    accentColor: "var(--accent)",
    rowHoverColor: "var(--accent-soft)",
    selectedRowBackgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
    oddRowBackgroundColor: "color-mix(in srgb, var(--bg) 45%, transparent)",
    checkboxCheckedBackgroundColor: "var(--accent)",
    checkboxCheckedBorderColor: "var(--accent)",
    checkboxBorderRadius: 4,
    headerColumnResizeHandleColor: "var(--accent)",
    // Inline editing (the autopilot rules grid) and validation
    cellEditingBorder: { color: "var(--accent)", width: 2 },
    inputFocusBorder: { color: "var(--accent)", width: 2 },
    inputInvalidBorder: { color: "var(--danger)", width: 2 },
    focusShadow: { radius: 3, spread: 0, color: "color-mix(in srgb, var(--accent) 35%, transparent)" },
    // Lines: rows only, a stronger rule under the header and above the totals row
    columnBorder: false,
    rowBorder: { color: "var(--line)" },
    headerRowBorder: { color: "var(--line)", width: 2 },
    pinnedRowBorder: { color: "var(--accent)", width: 2 },
    // Type and spacing
    fontFamily: "inherit",
    fontSize: 14,
    dataFontSize: 14,
    headerFontSize: 12,
    headerFontWeight: 600,
    iconSize: 14,
    wrapperBorderRadius: 10,
    borderRadius: 6,
    spacing: 7,
    cellHorizontalPadding: 14,
  });
