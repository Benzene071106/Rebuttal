// The same contract for the in-memory and Postgres stores. The Postgres half runs when
// TEST_DATABASE_URL points at a scratch database (it creates its own tables).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/lib/store/db";
import { memoryStore } from "../src/lib/store/memory";
import { postgresStore } from "../src/lib/store/postgres";
import type { Store } from "../src/lib/store";
import type { CaseRecord, Incident } from "../src/lib/types";

const caseOf = (id: string, extra: Partial<CaseRecord> = {}): CaseRecord =>
  ({ id, status: "NEW", trace: [], updated_at: "2026-11-01T00:00:00Z", dispute: { dispute_id: id, create_time: "2026-11-01T00:00:00Z" } as CaseRecord["dispute"], ...extra }) as CaseRecord;

const incident = (id: string, at: string) => ({ id, at, case_id: "c1", action: "REFUND", amount: 1, paypal: { status: 500, name: "X", message: "", debug_id: null }, kind: "TRANSIENT", attempts: [], plan: "RETRIED", diagnosis: "", seller_steps: [], result: "HEALED", by: "rules" }) as Incident;

function contract(name: string, make: (tenant: string) => Store, enabled = true) {
  describe.skipIf(!enabled)(name, () => {
    let n = 0;
    const fresh = () => make(`test:${name}:${Date.now()}:${n++}`);

    it("stores, patches and clears cases", async () => {
      const s = fresh();
      await s.putCase(caseOf("A"));
      expect((await s.getCase("A"))?.status).toBe("NEW");
      const next = await s.patchCase("A", { status: "READY", error: "boom" });
      expect(next?.status).toBe("READY");
      expect((await s.patchCase("A", { error: undefined }))?.error).toBeUndefined();
      expect(await s.patchCase("missing", { status: "READY" })).toBeUndefined();
      await s.clearCases();
      expect(await s.listCases()).toEqual([]);
    });

    it("keeps tenants apart", async () => {
      const a = fresh();
      const b = fresh();
      await a.putCase(caseOf("A"));
      expect(await b.getCase("A")).toBeUndefined();
      await a.setRules({ enabled: false, auto_refund_max: 1, auto_fight_min_win: 0, max_auto_amount: 2, negotiate_max_pct: 0.1 });
      expect(await b.getRules()).toBeNull();
    });

    it("doesn't lose concurrent patches or alerts", async () => {
      const s = fresh();
      await s.putCase(caseOf("A"));
      await Promise.all([s.patchCase("A", { status: "READY" }), s.patchCase("A", { error: "x" }), ...Array.from({ length: 10 }, (_, i) => s.appendActivity("A", { at: `2026-11-01T00:00:${String(i).padStart(2, "0")}Z`, text: `a${i}`, tone: "info" }, 20))]);
      const c = await s.getCase("A");
      expect(c?.status).toBe("READY");
      expect(c?.error).toBe("x");
      expect(c?.activity).toHaveLength(10);
    });

    it("seeds once and caps the incident log", async () => {
      const s = fresh();
      await s.seedCases(() => [caseOf("H1")]);
      await s.seedCases(() => [caseOf("H2")]);
      expect((await s.listCases()).map((c) => c.id)).toEqual(["H1"]);
      for (let i = 0; i < 5; i++) await s.addIncident(incident(`I${i}`, `2026-11-01T00:00:0${i}Z`), 3);
      expect((await s.listIncidents(10)).map((x) => x.id)).toEqual(["I4", "I3", "I2"]);
    });

    it("handles each webhook event once", async () => {
      const s = fresh();
      expect(await s.claimEvent("WH-1")).toBe(true);
      expect(await s.claimEvent("WH-1")).toBe(false);
    });
  });
}

const pgUrl = process.env.TEST_DATABASE_URL;
beforeAll(() => {
  if (pgUrl) process.env.DATABASE_URL = pgUrl;
});
afterAll(async () => {
  if (pgUrl) await closeDb();
});

contract("memory", (t) => memoryStore(`mock:${t}`));
contract("postgres", postgresStore, Boolean(pgUrl));
