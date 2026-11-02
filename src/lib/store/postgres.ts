// Postgres store. Cases, rules and incidents are JSON documents in tenant-scoped
// tables; merges and appends happen inside the database so concurrent writers (a
// webhook and a seller's click on two server instances) don't lose each other's changes.

import type { CaseRecord, Incident } from "../types";
import { query, tx } from "./db";
import type { Store } from "./index";

export function postgresStore(tenant: string): Store {
  return {
    async listCases() {
      return (await query<{ data: CaseRecord }>("select data from cases where tenant = $1", [tenant])).map((r) => r.data);
    },
    async getCase(id) {
      return (await query<{ data: CaseRecord }>("select data from cases where tenant = $1 and id = $2", [tenant, id]))[0]?.data;
    },
    async putCase(rec) {
      await query(
        `insert into cases (tenant, id, data) values ($1, $2, $3)
         on conflict (tenant, id) do update set data = excluded.data, updated_at = now()`,
        [tenant, rec.id, JSON.stringify(rec)],
      );
    },
    async patchCase(id, patch) {
      // jsonb || merges top-level keys, the same as { ...cur, ...patch }. A key set to
      // undefined clears that field, as it does in memory, so remove those first.
      const cleared = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] === undefined);
      const rows = await query<{ data: CaseRecord }>(
        "update cases set data = (data - $4::text[]) || $3::jsonb, updated_at = now() where tenant = $1 and id = $2 returning data",
        [tenant, id, JSON.stringify(patch), cleared],
      );
      return rows[0]?.data;
    },
    async appendActivity(id, item, keep) {
      return tx(async (c) => {
        const cur = (await c.query<{ data: CaseRecord }>("select data from cases where tenant = $1 and id = $2 for update", [tenant, id])).rows[0]?.data;
        if (!cur) return undefined;
        const next = { ...cur, activity: [...(cur.activity ?? []), item].slice(-keep), updated_at: item.at };
        await c.query("update cases set data = $3, updated_at = now() where tenant = $1 and id = $2", [tenant, id, JSON.stringify(next)]);
        return next;
      });
    },
    async seedCases(make) {
      const has = await query("select 1 from cases where tenant = $1 limit 1", [tenant]);
      if (has.length) return;
      for (const c of make()) await this.putCase(c);
    },
    async clearCases() {
      await query("delete from cases where tenant = $1", [tenant]);
    },

    async getRules() {
      return (await query<{ data: any }>("select data from rules where tenant = $1", [tenant]))[0]?.data ?? null;
    },
    async setRules(rules) {
      await query(
        `insert into rules (tenant, data) values ($1, $2)
         on conflict (tenant) do update set data = excluded.data, updated_at = now()`,
        [tenant, JSON.stringify(rules)],
      );
    },
    async clearRules() {
      await query("delete from rules where tenant = $1", [tenant]);
    },

    async listIncidents(limit) {
      return (await query<{ data: Incident }>("select data from incidents where tenant = $1 order by at desc limit $2", [tenant, limit])).map((r) => r.data);
    },
    async addIncident(inc, keep) {
      await tx(async (c) => {
        await c.query("insert into incidents (tenant, id, at, data) values ($1, $2, $3, $4) on conflict do nothing", [tenant, inc.id, inc.at, JSON.stringify(inc)]);
        await c.query(
          `delete from incidents where tenant = $1 and id not in
             (select id from incidents where tenant = $1 order by at desc limit $2)`,
          [tenant, keep],
        );
      });
    },
    async clearIncidents() {
      await query("delete from incidents where tenant = $1", [tenant]);
    },

    async claimEvent(eventId) {
      const rows = await query("insert into webhook_events (tenant, event_id) values ($1, $2) on conflict do nothing returning event_id", [tenant, eventId]);
      return rows.length > 0;
    },
    async releaseEvent(eventId) {
      await query("delete from webhook_events where tenant = $1 and event_id = $2", [tenant, eventId]);
    },
  };
}
