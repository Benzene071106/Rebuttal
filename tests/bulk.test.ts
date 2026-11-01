import { beforeEach, describe, expect, it } from "vitest";
import { approve } from "../src/lib/actions";
import { bulkApprove } from "../src/lib/bulk";
import { getCase, resetCases, syncCases, updateCase } from "../src/lib/cases";
import { historyCases, HISTORY_SIZE } from "../src/lib/demo/history";
import { armFault, resetMock } from "../src/lib/paypal/mock";
import { resetIncidents } from "../src/lib/recovery";
import { resetRules, setRules, DEFAULT_RULES } from "../src/lib/rules";
import type { Recommendation } from "../src/lib/types";

process.env.PAYPAL_MODE = "mock";

const rec = (decision: Recommendation["decision"]): Recommendation => ({
  decision, win_probability: 0.9, headline: "h", rationale: "r", evidence: [], response_to_paypal: "Response to PayPal.",
  tracking_carrier: "", tracking_number: "", offer_amount: decision === "OFFER" ? 10 : 0, offer_type: decision === "OFFER" ? "REFUND" : "NONE", risks: [],
});

describe("bulk approve", () => {
  beforeEach(() => {
    resetMock();
    resetCases();
    resetRules();
    resetIncidents();
  });

  it("sends the recommended refunds and evidence, and leaves offers, big amounts and lookup errors to the seller", async () => {
    const cases = await syncCases();
    const [a, b, c] = cases;
    updateCase(a.id, { status: "READY", recommendation: rec("REFUND") });
    updateCase(b.id, { status: "READY", recommendation: rec("OFFER") });
    updateCase(c.id, { status: "READY", recommendation: rec("FIGHT"), trace: [{ at: "", kind: "error", summary: "lookup failed" }] });
    setRules({ ...DEFAULT_RULES, max_auto_amount: Math.max(...cases.map((x) => Number(x.dispute.dispute_amount.value))) });
    const out = await bulkApprove([a.id, b.id, c.id]);
    expect(out.approved.map((x) => x.id)).toEqual([a.id]);
    expect(Object.fromEntries(out.skipped.map((x) => [x.id, x.reason]))).toMatchObject({
      [b.id]: expect.stringContaining("offers"),
      [c.id]: expect.stringContaining("lookup failed"),
    });
    expect(getCase(a.id)?.submitted?.decision).toBe("REFUND");
    expect(getCase(b.id)?.submitted).toBeUndefined();
  });

  it("enforces the hard cap on the server", async () => {
    const [a] = await syncCases();
    updateCase(a.id, { status: "READY", recommendation: rec("FIGHT") });
    setRules({ ...DEFAULT_RULES, auto_refund_max: 0, max_auto_amount: Number(a.dispute.dispute_amount.value) - 1 });
    const out = await bulkApprove([a.id]);
    expect(out.approved).toEqual([]);
    expect(out.skipped[0].reason).toContain("cap");
  });

  it("reports a PayPal failure on one dispute without stopping the rest", async () => {
    const cases = await syncCases();
    const small = cases.filter((x) => Number(x.dispute.dispute_amount.value) <= 250).slice(0, 2);
    for (const x of small) updateCase(x.id, { status: "READY", recommendation: rec("REFUND") });
    armFault("INSUFFICIENT_FUNDS");
    const out = await bulkApprove(small.map((x) => x.id));
    expect(out.failed).toHaveLength(1);
    expect(out.approved).toHaveLength(1);
  }, 30_000);

  it("refuses an already answered dispute", async () => {
    const [a, b] = await syncCases();
    updateCase(a.id, { status: "READY", recommendation: rec("REFUND") });
    await approve(a.id, { decision: "REFUND", response: "x" });
    const out = await bulkApprove([a.id, b.id]);
    expect(out.skipped.map((x) => x.reason)).toEqual([expect.stringContaining("Already answered"), expect.stringContaining("Not investigated")]);
  });
});

describe("demo history", () => {
  it("is the same every time, all closed, with repeat disputers and every outcome", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    const h = historyCases(now);
    expect(h).toHaveLength(HISTORY_SIZE);
    expect(historyCases(now)).toEqual(h);
    expect(h.every((c) => c.history && c.outcome && c.submitted && c.dispute.status === "RESOLVED")).toBe(true);
    expect(new Set(h.map((c) => c.id)).size).toBe(HISTORY_SIZE);
    expect(new Set(h.map((c) => c.outcome!.result))).toEqual(new Set(["WON", "LOST", "SETTLED", "REFUNDED"]));
    const byEmail = new Map<string, number>();
    for (const c of h) byEmail.set(c.dispute.disputed_transactions[0].buyer!.email!, (byEmail.get(c.dispute.disputed_transactions[0].buyer!.email!) ?? 0) + 1);
    expect(byEmail.get("c.haldane@example.com")).toBe(3);
    // Never the demo buyers, so the shield's scores don't change.
    for (const e of ["dana.w@example.com", "hannah.cole@example.com", "t.reyes.shop@example.com"]) expect(byEmail.has(e)).toBe(false);
    for (const c of h) expect(c.outcome!.amount_kept + c.outcome!.amount_lost).toBeCloseTo(Number(c.dispute.dispute_amount.value));
  });

  it("seeds each simulator unless turned off", async () => {
    process.env.REBUTTAL_SEED_HISTORY = "1";
    resetMock();
    resetCases();
    const cases = await syncCases();
    expect(cases.filter((c) => c.history)).toHaveLength(HISTORY_SIZE);
    expect(cases.filter((c) => !c.history).length).toBeGreaterThan(0);
    process.env.REBUTTAL_SEED_HISTORY = "0";
    resetCases();
  });
});
