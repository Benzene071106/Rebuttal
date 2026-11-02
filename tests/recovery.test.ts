import { beforeEach, describe, expect, it } from "vitest";
import { ingestDisputeEvent, runAutopilot } from "../src/lib/autopilot";
import { getCase, resetCases, syncCases } from "../src/lib/cases";
import { claudeModel } from "../src/lib/model";
import { paypal } from "../src/lib/paypal";
import { armFault, resetMock } from "../src/lib/paypal/mock";
import { classify, listIncidents, parsePayPalError, RecoveryPausedError, resetIncidents, withRecovery } from "../src/lib/recovery";
import { DEFAULT_RULES, setRules } from "../src/lib/rules";
import type { CaseRecord } from "../src/lib/types";

process.env.PAYPAL_MODE = "mock";
process.env.REBUTTAL_BACKOFF_MS = "1";

const FUNDS = `PayPal refused the refund: the seller's PayPal balance is too low to cover it (INSUFFICIENT_FUNDS). PayPal POST /v1/customer/disputes/PP-D-1/accept-claim failed (422): {"name":"UNPROCESSABLE_ENTITY","details":[{"issue":"INSUFFICIENT_FUNDS","description":"Sender does not have sufficient funds."}],"debug_id":"abc123def4567"}`;

// Scripted model that answers choose_recovery with the given input.
function choosing(input: Record<string, unknown>) {
  const client = { create: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "choose_recovery", input }] }) as any };
  return claudeModel({ client: client as any });
}

async function fileByWebhook() {
  await syncCases();
  const d = await paypal().fileTestDispute();
  return (await ingestDisputeEvent({ event_type: "CUSTOMER.DISPUTE.CREATED", resource: d })).case;
}

describe("reading PayPal errors", () => {
  it("pulls status, the detail issue and debug_id out of the gateway's message", () => {
    const f = parsePayPalError(new Error(FUNDS));
    expect(f).toMatchObject({ status: 422, name: "INSUFFICIENT_FUNDS", debug_id: "abc123def4567" });
    expect(classify(f)).toBe("BUSINESS");
    expect(classify(parsePayPalError(new Error('PayPal POST /x failed (503): {"name":"SERVICE_UNAVAILABLE"}')))).toBe("TRANSIENT");
    expect(classify(parsePayPalError(new Error('PayPal POST /x failed (401): {"error":"invalid_token"}')))).toBe("AUTH");
    expect(classify(parsePayPalError(new Error("fetch failed")))).toBe("TRANSIENT");
  });
});

describe("self-healing PayPal calls", () => {
  beforeEach(async () => {
    resetMock();
    await resetCases();
    await resetIncidents();
    await setRules({ ...DEFAULT_RULES });
  });

  it("retries through a PayPal outage and autopilot's refund still goes through", async () => {
    const c = await fileByWebhook();
    armFault("OUTAGE");
    const done = await runAutopilot(c.id);
    expect(done?.status).toBe("REFUNDED");
    const [inc] = await listIncidents();
    expect(inc).toMatchObject({ result: "HEALED", plan: "RETRIED", kind: "TRANSIENT", by: "rules", paypal: { status: 503, name: "SERVICE_UNAVAILABLE" } });
    expect(inc.attempts.map((a) => a.ok)).toEqual([false, false, true]);
    expect(done?.activity?.map((a) => a.text).join("\n")).toMatch(/Self-healed[\s\S]*retried 2 times[\s\S]*Autopilot refunded/);
  }, 20_000);

  it("refreshes an expired PayPal token and repeats the call", async () => {
    const c = await fileByWebhook();
    armFault("TOKEN_EXPIRED");
    const done = await runAutopilot(c.id);
    expect(done?.status).toBe("REFUNDED");
    expect((await listIncidents())[0]).toMatchObject({ kind: "AUTH", result: "HEALED" });
    expect((await listIncidents())[0].attempts.map((a) => a.what).join("\n")).toContain("Signed in to PayPal again");
  }, 20_000);

  it("doesn't retry a refused refund: the model diagnoses it and the case waits for the seller", async () => {
    await syncCases();
    const c = await getCase((await paypal().listDisputes())[0].dispute_id) as CaseRecord;
    let calls = 0;
    const model = choosing({ plan: "PAUSE_FOR_SELLER", diagnosis: "Your PayPal balance can't cover this refund.", seller_steps: ["Add funds to PayPal.", "Approve the refund again."], alternative_decision: "NONE", alternative_amount: 0, alternative_why: "" });
    const err = await withRecovery(c, "REFUND", 184, async () => { calls++; throw new Error(FUNDS); }, { model }).catch((e) => e);
    expect(err).toBeInstanceOf(RecoveryPausedError);
    expect(calls).toBe(1);
    expect(err.message).toContain("Add funds to PayPal.");
    expect((await listIncidents())[0]).toMatchObject({ plan: "PAUSE_FOR_SELLER", result: "WAITING_FOR_SELLER", by: "model" });
    expect((await getCase(c.id))?.activity?.at(-1)?.text).toContain("PayPal refused to refund (INSUFFICIENT_FUNDS)");
  });

  it("only proposes an alternative inside the guardrails, and never sends it", async () => {
    await syncCases();
    const c = await getCase((await paypal().listDisputes())[0].dispute_id) as CaseRecord;
    const fail = async () => { throw new Error(FUNDS); };
    // An offer at the full disputed amount is not a partial refund: the case just pauses.
    const greedy = choosing({ plan: "PROPOSE_ALTERNATIVE", diagnosis: "d", seller_steps: ["s"], alternative_decision: "OFFER", alternative_amount: 184, alternative_why: "w" });
    const e1 = await withRecovery(c, "REFUND", 184, fail, { model: greedy }).catch((e) => e);
    expect(e1.incident.plan).toBe("PAUSE_FOR_SELLER");
    expect(e1.incident.alternative).toBeUndefined();

    const fight = choosing({ plan: "PROPOSE_ALTERNATIVE", diagnosis: "The refund can't go through.", seller_steps: ["Review the evidence."], alternative_decision: "FIGHT", alternative_amount: 0, alternative_why: "Signed delivery to the checkout address." });
    const e2 = await withRecovery(c, "REFUND", 184, fail, { model: fight }).catch((e) => e);
    expect(e2.incident).toMatchObject({ plan: "PROPOSE_ALTERNATIVE", alternative: { decision: "FIGHT" } });
    expect((await getCase(c.id))?.submitted).toBeUndefined();
  });

  it("falls back to a rule-based plan when the model is down", async () => {
    await syncCases();
    const c = await getCase((await paypal().listDisputes())[0].dispute_id) as CaseRecord;
    const broken = { provider: "gemini", model: "x", next: async () => { throw new Error("quota"); } } as any;
    const err = await withRecovery(c, "REFUND", 184, async () => { throw new Error(FUNDS); }, { model: broken }).catch((e) => e);
    expect(err.incident).toMatchObject({ by: "rules", plan: "PAUSE_FOR_SELLER" });
    expect(err.incident.seller_steps[0]).toContain("Add funds");
  });
});
