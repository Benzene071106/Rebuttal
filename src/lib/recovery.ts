// Self-healing PayPal calls. When a write to PayPal fails while Rebuttal acts on a
// dispute, the agent reads PayPal's error (status, name, debug_id) and recovers:
// - a PayPal outage or timeout is retried with backoff, an expired token is refreshed
//   and retried, all in code;
// - anything else (a refused refund, a dispute in the wrong state) goes to the model,
//   which diagnoses it and either proposes another response or pauses the case with
//   steps for the seller.
// The agent never changes code and never widens a guardrail: an alternative it proposes
// always waits for the seller's approval, and nothing is retried that PayPal refused
// for a business reason.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { addActivity, updateCase } from "./cases";
import { defaultModel, type AgentModel } from "./model";
import type { ChatEntry } from "./model/types";
import { paypal, resetPayPalClient } from "./paypal";
import type { ToolDef } from "./paypal/gateway";
import { getRules } from "./rules";
import type { CaseRecord, Decision, Incident } from "./types";
import { storeFor } from "./store";
import { tenant, visitor } from "./visitor";

export type PayPalFailure = Incident["paypal"];

const RETRIES = 3;
const BACKOFF_MS = Number(process.env.REBUTTAL_BACKOFF_MS ?? 600);
const money = (n: number) => `$${n.toFixed(2)}`;
const VERB: Record<Decision, string> = { FIGHT: "send the evidence", OFFER: "send the offer", REFUND: "refund" };

// Pulls PayPal's error out of the gateway's message: "PayPal POST /path failed (422): {json}".
export function parsePayPalError(e: unknown): PayPalFailure {
  const message = e instanceof Error ? e.message : String(e);
  const status = Number(message.match(/\((\d{3})\)/)?.[1] ?? NaN);
  const json = message.match(/\{[\s\S]*\}$/)?.[0];
  let body: any = null;
  try {
    body = json ? JSON.parse(json) : null;
  } catch {
    // not JSON
  }
  const issue = body?.details?.[0]?.issue as string | undefined;
  const name = issue ?? body?.name ?? body?.error ?? message.match(/\b([A-Z][A-Z_]{5,})\b/)?.[1] ?? (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message) ? "NETWORK_ERROR" : "UNKNOWN");
  return { status: Number.isFinite(status) ? status : null, name: String(name), message: message.slice(0, 600), debug_id: body?.debug_id ?? message.match(/debug_id"?:\s*"?([a-z0-9]+)/i)?.[1] ?? null };
}

export function classify(f: PayPalFailure): Incident["kind"] {
  if (f.status === 401 || /invalid_token|AUTHENTICATION_FAILURE|expired/i.test(f.name)) return "AUTH";
  if ((f.status !== null && (f.status >= 500 || f.status === 429)) || f.name === "NETWORK_ERROR" || f.name === "RATE_LIMIT_REACHED") return "TRANSIENT";
  return "BUSINESS";
}

// Runs one PayPal write for a case. Recovers what it can; otherwise records why and
// throws a plain explanation for the seller.
export async function withRecovery(c: CaseRecord, action: Decision, amount: number, run: () => Promise<void>, opts: { model?: AgentModel } = {}): Promise<Incident | null> {
  const attempts: Incident["attempts"] = [];
  const at = () => new Date().toISOString();
  let failure: PayPalFailure | null = null;
  let kind: Incident["kind"] = "BUSINESS";

  for (let i = 0; i <= RETRIES; i++) {
    try {
      await run();
      if (!failure) return null; // worked first time: no incident
      attempts.push({ at: at(), what: `Retry ${i}: PayPal accepted the ${action === "REFUND" ? "refund" : action === "OFFER" ? "offer" : "evidence"}`, ok: true });
      const healed = await record(c, action, amount, failure, kind, attempts, {
        plan: "RETRIED",
        diagnosis: kind === "AUTH" ? "PayPal's access token had expired. Rebuttal signed in to PayPal again and repeated the call." : `PayPal was briefly unavailable (${failure.status ?? failure.name}). Rebuttal retried with backoff and the call went through.`,
        seller_steps: [],
        result: "HEALED",
        by: "rules",
      });
      await addActivity(c.id, `Self-healed: PayPal returned ${failure.status ?? ""} ${failure.name} while Rebuttal tried to ${VERB[action]}. ${kind === "AUTH" ? "Rebuttal refreshed its PayPal sign-in" : `Rebuttal retried ${i} time${i === 1 ? "" : "s"}`} and it went through.`, "good");
      return healed;
    } catch (e) {
      failure = parsePayPalError(e);
      kind = classify(failure);
      attempts.push({ at: at(), what: `${i === 0 ? "Call" : `Retry ${i}`}: PayPal returned ${failure.status ?? "an error"} ${failure.name}`, ok: false });
      // Only outages and expired tokens are worth repeating; PayPal won't change its mind
      // about a refused refund a second later.
      if (kind === "BUSINESS" || i === RETRIES) break;
      if (kind === "AUTH") {
        resetPayPalClient();
        attempts.push({ at: at(), what: "Signed in to PayPal again for a fresh access token", ok: true });
      }
      await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** i));
    }
  }

  const plan = await diagnose(c, action, amount, failure!, kind, attempts, opts.model);
  const incident = await record(c, action, amount, failure!, kind, attempts, { ...plan, result: "WAITING_FOR_SELLER" });
  const alt = incident.alternative;
  await addActivity(
    c.id,
    `PayPal refused to ${VERB[action]} (${failure!.name}). ${incident.diagnosis}${alt ? ` Proposed instead: ${alt.decision === "OFFER" ? `a ${money(alt.amount)} partial refund` : "fight with evidence"}, waiting for your approval.` : ""}`,
    "warn",
  );
  throw new RecoveryPausedError(incident);
}

export class RecoveryPausedError extends Error {
  constructor(readonly incident: Incident) {
    super(`${incident.diagnosis} ${incident.seller_steps.join(" ")}`.trim());
  }
}

type Plan = Pick<Incident, "plan" | "diagnosis" | "seller_steps" | "alternative" | "by" | "model">;

const SYSTEM = `You keep a small online shop's PayPal dispute responses working. A PayPal API call failed while Rebuttal acted on a dispute, and automatic retries are not appropriate or did not help. Read PayPal's error and choose how to recover, by calling choose_recovery once.

Plans:
- PAUSE_FOR_SELLER: the seller must do something first (add funds, re-authorize, wait for PayPal). Give 1 to 3 concrete steps.
- PROPOSE_ALTERNATIVE: another response would work and is reasonable for this dispute, for example fighting with evidence when the refund can't go through and the win estimate is decent, or a smaller partial refund. It is only proposed; the seller approves it.

Rules:
- Explain the error in one or two plain sentences a non-technical seller understands. Mention PayPal's debug_id only if it helps support.
- Never suggest changing code, settings limits, or retrying the same call immediately.
- An alternative partial refund must be below the disputed amount. Prefer PAUSE_FOR_SELLER when unsure.`;

const TOOL: ToolDef = {
  name: "choose_recovery",
  description: "Choose how to recover from the failed PayPal call.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["plan", "diagnosis", "seller_steps", "alternative_decision", "alternative_amount", "alternative_why"],
    properties: {
      plan: { type: "string", enum: ["PAUSE_FOR_SELLER", "PROPOSE_ALTERNATIVE"] },
      diagnosis: { type: "string", description: "What went wrong, in plain words." },
      seller_steps: { type: "array", items: { type: "string" }, description: "1 to 3 steps for the seller." },
      alternative_decision: { type: "string", enum: ["FIGHT", "OFFER", "NONE"] },
      alternative_amount: { type: "number", description: "Partial refund amount for OFFER, else 0." },
      alternative_why: { type: "string", description: "Why the alternative, or empty." },
    },
  },
};

const ChoiceSchema = z.object({
  plan: z.enum(["PAUSE_FOR_SELLER", "PROPOSE_ALTERNATIVE"]),
  diagnosis: z.string().min(1),
  seller_steps: z.array(z.string()).min(1).max(4),
  alternative_decision: z.enum(["FIGHT", "OFFER", "NONE"]),
  alternative_amount: z.number().min(0),
  alternative_why: z.string(),
});

async function diagnose(c: CaseRecord, action: Decision, amount: number, f: PayPalFailure, kind: Incident["kind"], attempts: Incident["attempts"], model?: AgentModel): Promise<Plan> {
  const disputed = Number(c.dispute.dispute_amount.value);
  const r = c.recommendation;
  const facts = {
    failed_action: action,
    amount,
    paypal_error: f,
    attempts: attempts.map((a) => a.what),
    dispute: { id: c.id, reason: c.dispute.reason, amount: disputed, stage: c.dispute.dispute_life_cycle_stage, status: c.dispute.status, due: c.dispute.seller_response_due_date },
    ai_recommendation: r ? { decision: r.decision, win_probability: r.win_probability, headline: r.headline } : null,
  };
  const key = await recoveryKey(c, action, f);
  const saved = loadPlan(key);
  if (saved) return saved;
  try {
    const m = model ?? defaultModel();
    const history: ChatEntry[] = [{ role: "user", text: `A PayPal call failed. Facts:\n${JSON.stringify(facts, null, 1)}` }];
    for (let turn = 0; turn < 3; turn++) {
      const res = await m.next({ system: SYSTEM, tools: [TOOL], history });
      const call = res.calls.find((x) => x.name === TOOL.name);
      if (!call) {
        history.push({ role: "assistant", turn: res }, { role: "user", text: "Call choose_recovery now." });
        continue;
      }
      const parsed = ChoiceSchema.safeParse(call.input);
      const p = parsed.success ? parsed.data : null;
      // Guardrails in code: an alternative must differ from what failed, and an offer must
      // stay below the disputed amount. Otherwise the case simply pauses.
      const altOk = p && p.plan === "PROPOSE_ALTERNATIVE" && p.alternative_decision !== "NONE" && p.alternative_decision !== action && (p.alternative_decision !== "OFFER" || (p.alternative_amount > 0 && p.alternative_amount < disputed));
      if (!p) break;
      const plan: Plan = {
        plan: altOk ? "PROPOSE_ALTERNATIVE" : "PAUSE_FOR_SELLER",
        diagnosis: p.diagnosis,
        seller_steps: p.seller_steps,
        alternative: altOk ? { decision: p.alternative_decision as Decision, amount: p.alternative_decision === "OFFER" ? p.alternative_amount : 0, why: p.alternative_why } : undefined,
        by: "model",
        model: `${m.provider}:${m.model}`,
      };
      if (!model) savePlan(key, plan);
      return plan;
    }
  } catch {
    // The model is down too: fall through to the rule-based plan.
  }
  return rulePlan(action, f, kind);
}

// Without the model: explain what we can from PayPal's error and leave it to the seller.
function rulePlan(action: Decision, f: PayPalFailure, kind: Incident["kind"]): Plan {
  const funds = /INSUFFICIENT_FUNDS/.test(f.name);
  return {
    plan: "PAUSE_FOR_SELLER",
    diagnosis: funds
      ? "PayPal refused the refund because the PayPal balance can't cover it."
      : kind === "BUSINESS"
        ? `PayPal refused the request (${f.name}).`
        : `PayPal kept failing (${f.status ?? f.name}) after ${RETRIES} retries.`,
    seller_steps: funds
      ? ["Add funds or link a bank to your PayPal account.", `Then approve the ${action === "REFUND" ? "refund" : "response"} again.`]
      : [`Check the dispute in PayPal${f.debug_id ? ` (PayPal debug_id ${f.debug_id})` : ""}.`, "Approve again when PayPal is back."],
    by: "rules",
  };
}

async function record(c: CaseRecord, action: Decision, amount: number, f: PayPalFailure, kind: Incident["kind"], attempts: Incident["attempts"], rest: Omit<Incident, "id" | "at" | "case_id" | "invoice" | "buyer" | "action" | "amount" | "paypal" | "kind" | "attempts">): Promise<Incident> {
  const t = c.dispute.disputed_transactions[0];
  const inc: Incident = {
    id: `INC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    at: new Date().toISOString(),
    case_id: c.id,
    invoice: t?.invoice_number,
    buyer: t?.buyer?.name,
    action,
    amount,
    paypal: f,
    kind,
    attempts,
    ...rest,
  };
  await storeFor(tenant()).addIncident(inc, KEEP_INCIDENTS);
  // A proposed alternative becomes the case's pending decision, for the seller to approve.
  if (rest.alternative && c.recommendation) {
    const a = rest.alternative;
    await updateCase(c.id, {
      status: "READY",
      recommendation: {
        ...c.recommendation,
        decision: a.decision,
        offer_amount: a.decision === "OFFER" ? a.amount : 0,
        offer_type: a.decision === "OFFER" ? "REFUND" : "NONE",
        headline: `PayPal refused to ${VERB[action]}. Proposed instead: ${a.decision === "OFFER" ? `a ${money(a.amount)} partial refund` : "fight with evidence"}.`,
        rationale: `${a.why} (Recovery after PayPal error ${f.name}.)`,
      },
    });
  }
  return inc;
}

// The incident log, per tenant like cases.
const KEEP_INCIDENTS = 50;
export async function listIncidents(): Promise<Incident[]> {
  return storeFor(tenant()).listIncidents(KEEP_INCIDENTS);
}
export async function resetIncidents() {
  if (visitor().mode === "mock") await storeFor(tenant()).clearIncidents();
}

// Saved diagnoses, like saved investigations, so the hosted demo doesn't spend model
// quota on the same simulated failure.
const dir = () => path.join(process.env.REBUTTAL_CACHE_DIR ?? path.join(process.cwd(), "cache", "investigations"), "..", "recoveries");
async function recoveryKey(c: CaseRecord, action: Decision, f: PayPalFailure) {
  const facts = { invoice: c.dispute.disputed_transactions[0]?.invoice_number ?? c.id, action, error: f.name, status: f.status, rec: c.recommendation?.decision ?? null, limit: (await getRules()).max_auto_amount };
  return `${String(facts.invoice).replace(/[^A-Za-z0-9_-]/g, "")}-${crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 12)}`;
}
function loadPlan(key: string): Plan | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${key}.json`), "utf8")).plan as Plan;
  } catch {
    return null;
  }
}
function savePlan(key: string, plan: Plan) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), `${key}.json`), JSON.stringify({ key, saved_at: new Date().toISOString(), plan }, null, 2));
  } catch {
    // cache only
  }
}

