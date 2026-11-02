import { beforeEach, describe, expect, it } from "vitest";
import { listCases, resetCases, syncCases, updateCase } from "../src/lib/cases";
import { claudeModel } from "../src/lib/model";
import { negotiate, validate } from "../src/lib/negotiation";
import { armFault, resetMock } from "../src/lib/paypal/mock";
import { listIncidents, resetIncidents } from "../src/lib/recovery";
import type { Recommendation } from "../src/lib/types";

process.env.PAYPAL_MODE = "mock";
process.env.REBUTTAL_CACHE_DIR = "/nonexistent/investigations"; // no saved moves: the model (or fallback) decides

const rec: Recommendation = {
  decision: "OFFER", win_probability: 0.7, headline: "Offer $24", rationale: "One of four mugs chipped.", evidence: [],
  response_to_paypal: "We offer $24.", tracking_carrier: "", tracking_number: "", offer_amount: 24, offer_type: "REFUND", risks: [],
};

// Scripted model: each entry is the negotiation_move input for one call.
function scripted(moves: Array<Record<string, unknown>>) {
  let i = 0;
  const calls: any[] = [];
  const client = {
    create: async (params: any) => {
      calls.push(params);
      const m = moves[i++];
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `tu_${i}`, name: "negotiation_move", input: m }] } as any;
    },
  };
  return { model: claudeModel({ client: client as any }), calls };
}

async function mugCase() {
  await syncCases();
  const c = (await listCases()).find((x) => x.dispute.disputed_transactions[0].invoice_number === "JK-1057")!;
  return await updateCase(c.id, { status: "READY", recommendation: rec });
}

describe("negotiation guardrails", () => {
  const m = (action: string, amount: number) => ({ action, amount, message: "hi", reasoning: "r" }) as any;
  it("blocks offers above the ceiling, backwards offers, and accepting an ask over the ceiling", () => {
    expect(validate(m("OFFER", 40), 38.4, 0, 96)).toMatch(/above your ceiling/);
    expect(validate(m("OFFER", 20), 38.4, 24, 48)).toMatch(/never go backwards/);
    expect(validate(m("OFFER", 50), 60, 24, 48)).toMatch(/use ACCEPT/);
    expect(validate(m("ACCEPT", 48), 38.4, 24, 48)).toMatch(/can't accept/);
    expect(validate(m("OFFER", 30), 38.4, 24, 48)).toBeNull();
  });
});

describe("negotiate", () => {
  beforeEach(async () => {
    resetMock();
    await resetCases();
  });

  it("haggles with the buyer through PayPal offers and settles inside the ceiling", async () => {
    const c = await mugCase();
    const { model, calls } = scripted([
      { action: "OFFER", amount: 24, message: "We can refund $24 for the chipped mug.", reasoning: "One mug of four." },
      { action: "OFFER", amount: 50, message: "ok", reasoning: "too high" }, // rejected: above the ceiling
      { action: "OFFER", amount: 32, message: "The listing notes glaze varies, but we can do $32.", reasoning: "Meet partway." },
    ]);
    const out = await negotiate(c.id, { maxRefund: 38.4, model });
    expect(out.negotiation?.status).toBe("SETTLED");
    expect(out.outcome).toMatchObject({ result: "SETTLED", amount_kept: 64, amount_lost: 32 });
    expect(out.negotiation?.turns.map((t) => [t.from, t.amount])).toEqual([
      ["AGENT", 24], ["BUYER", 48], ["AGENT", 32], ["BUYER", undefined],
    ]);
    // The ceiling violation went back to the model as an error.
    expect(JSON.stringify(calls[2].messages.at(-1))).toContain("above your ceiling");
    expect(out.activity?.at(-1)?.text).toContain("settled with the buyer at $32.00");
  }, 30_000);

  it("falls back to rule-based moves when the model fails, still inside the ceiling", async () => {
    const c = await mugCase();
    const broken = { provider: "gemini", model: "x", next: async () => { throw new Error("quota"); } } as any;
    const out = await negotiate(c.id, { maxRefund: 38.4, model: broken });
    const offers = out.negotiation!.turns.filter((t) => t.from === "AGENT");
    expect(offers.every((t) => t.by === "rules" && t.amount! <= 38.4)).toBe(true);
    expect(out.negotiation?.status).toBe("SETTLED");
  }, 30_000);

  it("hands the case back when the buyer won't come down to the ceiling", async () => {
    const c = await mugCase();
    const { model } = scripted([
      { action: "OFFER", amount: 10, message: "We can do $10.", reasoning: "Low open." },
      { action: "OFFER", amount: 12, message: "$12.", reasoning: "Small step." },
      { action: "OFFER", amount: 14, message: "$14.", reasoning: "Small step." },
    ]);
    const out = await negotiate(c.id, { maxRefund: 20, model });
    expect(out.negotiation?.status).toBe("HANDED_BACK");
    expect(out.outcome).toBeUndefined();
    expect(out.status).toBe("READY"); // the seller can fight now
  }, 40_000);
});

describe("negotiate during a PayPal outage", () => {
  beforeEach(async () => {
    resetMock();
    await resetCases();
    await resetIncidents();
  });

  it("retries the offer through the self-healing layer instead of handing back", async () => {
    const c = await mugCase();
    armFault("OUTAGE");
    const broken = { provider: "gemini", model: "x", next: async () => { throw new Error("quota"); } } as any;
    const out = await negotiate(c.id, { maxRefund: 38.4, model: broken });
    expect(out.negotiation?.status).toBe("SETTLED");
    expect((await listIncidents()).some((i) => i.result === "HEALED")).toBe(true);
  }, 30_000);

  it("can be started again after it was handed back, and the alert has no raw JSON", async () => {
    const c = await mugCase();
    const broken = { provider: "gemini", model: "x", next: async () => { throw new Error("quota"); } } as any;
    // A business error is not retried, so PayPal refusing the offer hands the case back.
    const gw = (await import("../src/lib/paypal")).paypal();
    const real = gw.makeOffer;
    gw.makeOffer = async () => { throw new Error('PayPal POST /v1/customer/disputes/x/make-offer failed (422): {"name":"UNPROCESSABLE_ENTITY","details":[{"issue":"OFFER_NOT_ALLOWED","description":"Offer not allowed."}]}'); };
    try {
      const first = await negotiate(c.id, { maxRefund: 38.4, model: broken });
      expect(first.negotiation?.status).toBe("HANDED_BACK");
      expect(first.negotiation?.note).not.toContain("{");
    } finally {
      gw.makeOffer = real;
    }
    const again = await negotiate(c.id, { maxRefund: 38.4, model: broken });
    expect(again.negotiation?.status).toBe("SETTLED");
  }, 30_000);
});
