// In-memory store. Simulator tenants are kept per browser with an LRU cap, so past
// judges' simulators don't pile up. The shared sandbox tenant is mirrored to
// data/*.json so a restart of the dev server keeps its history (as before Postgres).

import fs from "node:fs";
import path from "node:path";
import type { ActivityItem, AutopilotRules, CaseRecord, Incident } from "../types";
import type { Store } from "./index";

type TenantState = { cases?: Map<string, CaseRecord>; rules?: AutopilotRules | null; incidents?: Incident[]; events: Set<string> };

const MAX_TENANTS = 500;
const g = globalThis as unknown as { __rebuttalMemory?: Map<string, TenantState> };

function state(tenant: string): TenantState {
  g.__rebuttalMemory ??= new Map();
  const m = g.__rebuttalMemory;
  let s = m.get(tenant);
  if (s) m.delete(tenant);
  else s = { events: new Set() };
  m.set(tenant, s);
  while (m.size > MAX_TENANTS) m.delete(m.keys().next().value as string);
  return s;
}

// Only tenants that aren't simulators are mirrored to disk.
const mirrored = (tenant: string) => !tenant.startsWith("mock:");
const file = (name: string) => path.join(process.cwd(), "data", `${name}.json`);
// The shared sandbox keeps the file names it always had; sellers without a database get their own.
const fileName = (tenant: string, kind: string) => (tenant === "sandbox" ? kind : `${tenant.replace(/[^A-Za-z0-9_-]/g, "_")}-${kind}`);

function readFile<T>(tenant: string, kind: string): T | undefined {
  if (!mirrored(tenant)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file(fileName(tenant, kind)), "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeFile(tenant: string, kind: string, value: unknown) {
  if (!mirrored(tenant)) return;
  try {
    fs.mkdirSync(path.dirname(file(kind)), { recursive: true });
    fs.writeFileSync(file(fileName(tenant, kind)), JSON.stringify(value, null, 2));
  } catch {
    // read-only disk: the data stays in memory
  }
}

export function memoryStore(tenant: string): Store {
  const cases = () => {
    const s = state(tenant);
    s.cases ??= new Map((readFile<CaseRecord[]>(tenant, "cases") ?? []).map((c) => [c.id, c]));
    return s.cases;
  };
  const saveCases = () => writeFile(tenant, "cases", [...cases().values()]);
  const incidents = () => {
    const s = state(tenant);
    s.incidents ??= readFile<Incident[]>(tenant, "incidents") ?? [];
    return s.incidents;
  };

  return {
    async listCases() {
      return [...cases().values()];
    },
    async getCase(id) {
      return cases().get(id);
    },
    async putCase(rec) {
      cases().set(rec.id, rec);
      saveCases();
    },
    async patchCase(id, patch) {
      const cur = cases().get(id);
      if (!cur) return undefined;
      const next = { ...cur, ...patch };
      cases().set(id, next);
      saveCases();
      return next;
    },
    async appendActivity(id, item: ActivityItem, keep) {
      const cur = cases().get(id);
      if (!cur) return undefined;
      const next = { ...cur, activity: [...(cur.activity ?? []), item].slice(-keep), updated_at: item.at };
      cases().set(id, next);
      saveCases();
      return next;
    },
    async seedCases(make) {
      const s = state(tenant);
      if (s.cases) return;
      const saved = readFile<CaseRecord[]>(tenant, "cases");
      s.cases = new Map((saved ?? make()).map((c) => [c.id, c]));
    },
    async clearCases() {
      const s = state(tenant);
      s.cases = mirrored(tenant) ? new Map() : undefined;
      if (mirrored(tenant)) saveCases();
    },

    async getRules() {
      const s = state(tenant);
      if (s.rules === undefined) s.rules = readFile<AutopilotRules>(tenant, "rules") ?? null;
      return s.rules;
    },
    async setRules(rules) {
      state(tenant).rules = rules;
      writeFile(tenant, "rules", rules);
    },
    async clearRules() {
      state(tenant).rules = null;
    },

    async listIncidents(limit) {
      return incidents().slice(0, limit);
    },
    async addIncident(inc, keep) {
      const list = incidents();
      list.unshift(inc);
      list.splice(keep);
      writeFile(tenant, "incidents", list);
    },
    async clearIncidents() {
      state(tenant).incidents = mirrored(tenant) ? [] : undefined;
    },

    async claimEvent(eventId) {
      const s = state(tenant);
      if (s.events.has(eventId)) return false;
      s.events.add(eventId);
      if (s.events.size > 1000) s.events.delete(s.events.values().next().value as string);
      return true;
    },
    async releaseEvent(eventId) {
      state(tenant).events.delete(eventId);
    },
  };
}
