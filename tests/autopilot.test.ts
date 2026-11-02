import { beforeEach, describe, expect, it } from "vitest";
import { ingestDisputeEvent, runAutopilot } from "../src/lib/autopilot";
import { getCase, listCases, resetCases, stats, syncCases } from "../src/lib/cases";
import { paypal } from "../src/lib/paypal";
import { resetMock } from "../src/lib/paypal/mock";
import { DEFAULT_RULES, evaluateRules, setRules } from "../src/lib/rules";
import type { CaseRecord, Recommendation } from "../src/lib/types";

process.env.PAYPAL_MODE = "mock";

const rec = (over: Partial<Recommendation>): Recommendation => ({
  decision: "REFUND", win_probability: 0.1, headline: "h", rationale: "r", evidence: [], response_to_paypal: "note",
  tracking_carrier: "", tracking_number: "", offer_amount: 0, offer_type: "NONE", risks: [], ...over,
});

const caseOf = (amount: string, r: Recommendation, trace: CaseRecord["trace"] = []): CaseRecord => ({
  id: "PP-D-1", status: "READY", recommendation: r, trace, updated_at: "",
  dispute: { dispute_amount: { currency_code: "USD", value: amount } } as CaseRecord["dispute"],
});

describe("evaluateRules", () => {
  it("refunds small disputes the AI says to refund", () => {
    expect(evaluateRules(caseOf("28.00", rec({})), DEFAULT_RULES).act).toBe("REFUND");
    expect(evaluateRules(caseOf("31.00", rec({})), DEFAULT_RULES).act).toBeNull();
  });

  it("keeps fights with the seller unless auto-fight is on and the win chance is high enough", () => {
    const fight = rec({ decision: "FIGHT", win_probability: 0.95 });
    expect(evaluateRules(caseOf("184.00", fight), DEFAULT_RULES).act).toBeNull();
    expect(evaluateRules(caseOf("184.00", fight), { ...DEFAULT_RULES, auto_fight_min_win: 0.9 }).act).toBe("FIGHT");
    expect(evaluateRules(caseOf("184.00", fight), { ...DEFAULT_RULES, auto_fight_min_win: 0.97 }).act).toBeNull();
  });

  it("never acts over the hard cap, after tool errors, on offers, or when switched off", () => {
    const all = { ...DEFAULT_RULES, auto_refund_max: 1000, auto_fight_min_win: 0.5 };
    expect(evaluateRules(caseOf("300.00", rec({})), all).act).toBeNull();
    expect(evaluateRules(caseOf("20.00", rec({}), [{ at: "", kind: "error", summary: "403" }]), all).act).toBeNull();
    expect(evaluateRules(caseOf("20.00", rec({ decision: "OFFER", offer_amount: 5 })), all).act).toBeNull();
    expect(evaluateRules(caseOf("20.00", rec({})), { ...all, enabled: false }).act).toBeNull();
  });
});

describe("autopilot", () => {
  beforeEach(async () => {
    resetMock();
    await resetCases();
    await setRules({ ...DEFAULT_RULES });
  });

  // The fourth simulator dispute is the $28 untracked print; its saved investigation says REFUND.
  async function fileByWebhook() {
    await syncCases();
    const d = await paypal().fileTestDispute();
    return ingestDisputeEvent({ event_type: "CUSTOMER.DISPUTE.CREATED", resource: d });
  }

  it("investigates a webhook dispute and refunds it through PayPal when the rules allow", async () => {
    const { case: c, investigate } = await fileByWebhook();
    expect(investigate).toBe(true);
    expect(c.source).toBe("webhook");
    expect(c.dispute.dispute_amount.value).toBe("28.00");

    const done = await runAutopilot(c.id);
    expect(done?.autopilot?.action).toBe("AUTO_REFUNDED");
    expect(done?.status).toBe("REFUNDED");
    expect(done?.submitted?.by).toBe("autopilot");
    expect((await paypal().getDispute(c.id)).dispute_outcome?.outcome_code).toBe("RESOLVED_BUYER_FAVOUR");
    expect(done?.activity?.map((a) => a.text).join("\n")).toMatch(/PayPal webhook[\s\S]*Autopilot refunded \$28\.00/);

    const s = stats(await listCases());
    expect(s.autopilot).toBe(1);
    expect(s.hours_saved).toBe(0.8);
  }, 20_000);

  it("leaves the case for the seller and says why when a rule doesn't allow it", async () => {
    await setRules({ ...DEFAULT_RULES, auto_refund_max: 10 });
    const { case: c } = await fileByWebhook();
    const done = await runAutopilot(c.id);
    expect(done?.autopilot?.action).toBe("NEEDS_APPROVAL");
    expect(done?.status).toBe("READY");
    expect(done?.autopilot?.reason).toContain("above your auto-refund limit of $10");
    expect(done?.activity?.at(-1)?.text).toContain("Needs your approval");
  }, 20_000);

  it("ignores a repeated CREATED webhook for a dispute it already has", async () => {
    const { case: c } = await fileByWebhook();
    const again = await ingestDisputeEvent({ event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: c.id } });
    expect(again.investigate).toBe(false);
    expect((await getCase(c.id))?.activity).toHaveLength(1);
  });
});
