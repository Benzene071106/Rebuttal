import { beforeEach, describe, expect, it } from "vitest";
import { approve } from "../src/lib/actions";
import { resetCases, syncCases, updateCase } from "../src/lib/cases";
import { paypal } from "../src/lib/paypal";
import { armedFault, armFault, MAX_OPEN_SIM_DISPUTES, resetMock } from "../src/lib/paypal/mock";
import { resetIncidents } from "../src/lib/recovery";
import { DEFAULT_RULES, RulesSchema } from "../src/lib/rules";

process.env.PAYPAL_MODE = "mock";

describe("stress-test limits", () => {
  beforeEach(() => {
    resetMock();
    resetCases();
    resetIncidents();
  });

  it("caps how many open disputes one visitor can simulate", async () => {
    await syncCases();
    const gw = paypal();
    const filed: unknown[] = [];
    await expect(async () => {
      for (let i = 0; i < MAX_OPEN_SIM_DISPUTES + 5; i++) filed.push(await gw.fileTestDispute());
    }).rejects.toThrow(`at most ${MAX_OPEN_SIM_DISPUTES}`);
    expect((await gw.listDisputes()).filter((d) => !d.dispute_outcome).length).toBe(MAX_OPEN_SIM_DISPUTES);
  });

  it("rejects rules whose auto-refund limit is above the hard cap, whoever sends them", () => {
    expect(RulesSchema.safeParse({ ...DEFAULT_RULES, auto_refund_max: 5000, max_auto_amount: 10 }).success).toBe(false);
    expect(RulesSchema.safeParse(DEFAULT_RULES).success).toBe(true);
  });

  it("uses up an armed 'insufficient funds' fault on the next write, even when it isn't a refund", async () => {
    const [a] = await syncCases();
    updateCase(a.id, { status: "READY" });
    armFault("INSUFFICIENT_FUNDS");
    await approve(a.id, { decision: "FIGHT", response: "Evidence attached." });
    expect(armedFault()).toBeNull();
  });
});
