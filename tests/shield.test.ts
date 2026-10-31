import { beforeEach, describe, expect, it } from "vitest";
import { resetCases, syncCases } from "../src/lib/cases";
import { claudeModel } from "../src/lib/model";
import { paypal } from "../src/lib/paypal";
import { resetMock } from "../src/lib/paypal/mock";
import { getBuyerHistory, resetShield, runShield, scoreOrder } from "../src/lib/shield";

process.env.PAYPAL_MODE = "mock";
process.env.REBUTTAL_CACHE_DIR = "/nonexistent/investigations"; // no saved checks

// Scripted model: reads the order and the buyer's history, then submits the given verdict.
function scripted(email: string, verdict: Record<string, unknown>, orderId: string) {
  const turns = [
    [{ name: "get_order", input: { id: orderId } }],
    [{ name: "get_buyer_history", input: { email } }],
    [{ name: "submit_risk", input: verdict }],
  ];
  let i = 0;
  const calls: any[] = [];
  const client = {
    create: async (params: any) => {
      calls.push(params);
      const t = turns[i++];
      return { stop_reason: "tool_use", content: t.map((c, j) => ({ type: "tool_use", id: `tu_${i}_${j}`, ...c })) } as any;
    },
  };
  return { model: claudeModel({ client: client as any }), calls };
}

describe("dispute shield", () => {
  beforeEach(() => {
    resetMock();
    resetCases();
    resetShield();
  });

  it("remembers a buyer's past disputes and the shop's evidence against them", async () => {
    await syncCases();
    const h = await getBuyerHistory("Dana.W@example.com");
    expect(h.disputes_filed).toBe(1);
    expect(h.disputes[0]).toMatchObject({ invoice_id: "JK-1042", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", outcome: "OPEN" });
    expect(h.disputes[0].shop_evidence).toMatchObject({ signature_required: true, signed_by: "WHITFIELD" });
    expect((await getBuyerHistory("hannah.cole@example.com")).disputes_filed).toBe(0);
  });

  it("checks a paid order with get_order and the buyer's history, and the score sets the band", async () => {
    const orders = await paypal().ordersAwaitingShipment();
    const dana = orders.find((o) => o.invoice_id === "JK-1093")!;
    const { model, calls } = scripted("dana.w@example.com", {
      risk: "MEDIUM", score: 78, headline: "This buyer says a signed-for parcel never arrived.",
      signals: [{ finding: "Open not-received dispute on JK-1042, signed by WHITFIELD", effect: "RAISES", source: "get_buyer_history" }],
      actions: ["Ship with signature confirmation"],
    }, dana.order_id);
    const out = await runShield(dana.order_id, { model });
    expect(out.status).toBe("READY");
    expect(out.verdict?.risk).toBe("HIGH"); // 78 is HIGH whatever the model said
    expect(out.trace.map((t) => t.tool ?? t.kind)).toEqual(["get_order", "get_buyer_history", "note"]);
    expect(out.trace[0].summary).toContain("Dana Whitfield");
    expect(out.trace[1].summary).toContain("1 past dispute (JK-1042)");
    // The model only ever sees read tools plus submit_risk.
    expect(calls[0].tools.map((t: any) => t.name).sort()).toEqual(["get_buyer_history", "get_order", "submit_risk"]);
  });

  it("still shows the rule-based check when the AI fails", async () => {
    const [first] = await paypal().ordersAwaitingShipment();
    const broken = { provider: "gemini", model: "x", next: async () => { throw new Error("quota"); } } as any;
    const out = await runShield(first.order_id, { model: broken });
    expect(out.status).toBe("READY");
    expect(out.model).toBe("rules");
    expect(out.notice).toContain("busy");
    expect(out.verdict?.risk).toBe("HIGH");
    expect(out.verdict?.actions.length).toBeGreaterThan(0);
  });

  it("gives the same risk level for the same order every time, whatever the model says", async () => {
    await syncCases();
    const orders = await paypal().ordersAwaitingShipment();
    const expected: Record<string, string> = { "JK-1088": "HIGH", "JK-1090": "LOW", "JK-1093": "HIGH" };
    for (const o of orders) {
      const order = await paypal().runTool("get_order", { id: o.order_id });
      const history = await getBuyerHistory((order as any).payer.email_address);
      const a = scoreOrder(order, history);
      const b = scoreOrder(structuredClone(order), structuredClone(history));
      expect(b).toEqual(a);
      expect(a.risk).toBe(expected[o.invoice_id]);
    }
    // Two runs where the model claims opposite risks still land on the same rule score.
    const dana = orders.find((o) => o.invoice_id === "JK-1093")!;
    const results = [];
    for (const claim of [{ risk: "LOW", score: 3 }, { risk: "HIGH", score: 99 }]) {
      resetShield();
      const { model } = scripted("dana.w@example.com", { ...claim, headline: "Explained.", actions: ["Ship with signature confirmation"] }, dana.order_id);
      results.push((await runShield(dana.order_id, { model })).verdict);
    }
    expect(results[0]?.score).toBe(results[1]?.score);
    expect(results[0]?.risk).toBe("HIGH");
    expect(results[1]?.signals).toEqual(results[0]?.signals);
  });

  it("weighs a repeat disputer whose parcel was signed for above a first-time buyer", () => {
    const order = { payer: { name: { given_name: "A", surname: "B" }, address: { address_line_1: "1 Main", postal_code: "1" } }, payment_source: { paypal: { account_status: "VERIFIED" } }, purchase_units: [{ amount: { value: "50" }, shipping: { name: { full_name: "A B" }, address: { address_line_1: "1 Main", postal_code: "1" }, options: [] } }] };
    const clean = scoreOrder(order, { completed_orders: 0, disputes: [] });
    const repeat = scoreOrder(order, { completed_orders: 1, disputes: [{ invoice_id: "X", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", outcome: "OPEN", shop_evidence: { signed_by: "B" } } as any] });
    expect(clean.risk).toBe("LOW");
    expect(repeat.risk).toBe("HIGH");
    expect(repeat.signals.some((x) => x.finding.includes("signed for by B"))).toBe(true);
  });
});
