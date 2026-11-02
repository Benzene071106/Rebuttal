// Where Rebuttal keeps its records. Every record belongs to a tenant: one simulator
// visitor ("mock:<visitor id>"), the shared demo sandbox ("sandbox"), or a signed-in
// seller ("seller:<seller id>").
//
// - Simulator tenants always live in memory. They are throwaway demo state, recreated
//   with the demo shop's history for each new browser.
// - Everything else goes to Postgres when DATABASE_URL is set, so a restart or a second
//   server instance sees the same cases, rules and incidents.
// - Without DATABASE_URL (local development, the hackathon demo) the shared sandbox
//   falls back to memory mirrored to data/*.json, as before.

import type { ActivityItem, AutopilotRules, CaseRecord, Incident } from "../types";
import { memoryStore } from "./memory";
import { postgresStore } from "./postgres";

export interface Store {
  listCases(): Promise<CaseRecord[]>;
  getCase(id: string): Promise<CaseRecord | undefined>;
  // Inserts or replaces a whole case.
  putCase(rec: CaseRecord): Promise<void>;
  // Shallow-merges `patch` into the stored case in one step, so two writers patching
  // different fields don't overwrite each other. Returns the merged case.
  patchCase(id: string, patch: Partial<CaseRecord>): Promise<CaseRecord | undefined>;
  // Appends an alert, keeping the newest `keep`.
  appendActivity(id: string, item: ActivityItem, keep: number): Promise<CaseRecord | undefined>;
  // Runs `make` to fill an empty case list once (the simulator's demo history).
  seedCases(make: () => CaseRecord[]): Promise<void>;
  clearCases(): Promise<void>;

  getRules(): Promise<AutopilotRules | null>;
  setRules(rules: AutopilotRules): Promise<void>;
  clearRules(): Promise<void>;

  listIncidents(limit: number): Promise<Incident[]>;
  addIncident(inc: Incident, keep: number): Promise<void>;
  clearIncidents(): Promise<void>;

  // Records a webhook delivery; false if this PayPal event id was already handled.
  claimEvent(eventId: string): Promise<boolean>;
  // Forgets a claimed event whose handling failed, so PayPal's retry is processed.
  releaseEvent(eventId: string): Promise<void>;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function storeFor(tenant: string): Store {
  if (tenant.startsWith("mock:") || !databaseConfigured()) return memoryStore(tenant);
  return postgresStore(tenant);
}
