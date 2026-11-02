import { beforeEach, describe, expect, it } from "vitest";
import { resetCases, syncCases, updateCase } from "../src/lib/cases";
import { buyerHash, listNetwork, networkFor, reportFromCase } from "../src/lib/network";
import { paypal } from "../src/lib/paypal";
import { resetMock } from "../src/lib/paypal/mock";
import { getBuyerHistory, scoreOrder } from "../src/lib/shield";

process.env.PAYPAL_MODE = "mock";

describe("Rebuttal network", () => {
  beforeEach(() => {
    resetMock();
    resetCases();
  });

  it("matches buyers by a salted hash, case-insensitively, and never stores the email", () => {
    expect(buyerHash("Dana.W@example.com ")).toBe(buyerHash("dana.w@example.com"));
    expect(buyerHash("dana.w@example.com")).toMatch(/^[0-9a-f]{16}$/);
    const { accounts } = listNetwork([]);
    expect(JSON.stringify(accounts)).not.toContain("@");
  });

  it("warns about the forwarder buyer and Dana, and not about a clean repeat buyer", async () => {
    await syncCases();
    expect(networkFor("t.reyes.shop@example.com").other_shops).toBe(2);
    expect(networkFor("dana.w@example.com").other_shops).toBe(1);
    expect(networkFor("hannah.cole@example.com").other_shops).toBe(0);
    expect(networkFor(null).other_shops).toBe(0);
  });

  it("raises the shield score with a sourced network signal", async () => {
    await syncCases();
    const orders = await paypal().ordersAwaitingShipment();
    const dana = orders.find((o) => o.invoice_id === "JK-1093")!;
    const order = await paypal().runTool("get_order", { id: dana.order_id });
    const history = await getBuyerHistory("dana.w@example.com");
    const withNet = scoreOrder(order, history);
    const without = scoreOrder(order, { ...history, network: undefined });
    expect(withNet.score - without.score).toBe(20);
    expect(withNet.signals.find((s) => s.source === "rebuttal_network")?.finding).toContain("1 other shop");
  });

  it("shares this shop's own wins only when the evidence contradicted the claim", async () => {
    const [c] = await syncCases();
    const won = { ...c, outcome: { result: "WON" as const, amount_kept: 1, amount_lost: 0, at: new Date().toISOString() } };
    const signed = { decision: "FIGHT" as const, win_probability: 0.9, headline: "", rationale: "", response_to_paypal: "", tracking_carrier: "", tracking_number: "", offer_amount: 0, offer_type: "NONE" as const, risks: [], evidence: [{ type: "PROOF_OF_DELIVERY_SIGNATURE" as const, summary: "Signed", source: "x" }] };
    expect(reportFromCase({ ...won, recommendation: { ...signed, evidence: [] } })).toBeNull();
    expect(reportFromCase({ ...won, outcome: undefined, recommendation: signed })).toBeNull();
    const r = reportFromCase({ ...won, dispute: { ...c.dispute, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" }, recommendation: signed });
    expect(r).toMatchObject({ shop: "Juniper & Kiln", simulated_shop: false, outcome: "WON" });
    updateCase(c.id, { outcome: won.outcome, recommendation: signed, dispute: { ...c.dispute, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" } });
    expect(listNetwork([]).shared).toBe(1);
  });
});
