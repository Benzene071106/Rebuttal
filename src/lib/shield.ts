// Dispute shield: before the seller ships a paid order, the AI checks how likely it is to
// come back as a dispute and what to do about it now, while the seller still can (ask
// for a signature, confirm the address, hold the parcel). It reads the PayPal order with
// the Agent Toolkit's get_order and the buyer's history, including every dispute
// Rebuttal has handled for that buyer ("dispute memory").

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { listCases, syncCases } from "./cases";
import { PENDING_ORDERS } from "./demo/orders";
import { defaultModel, type AgentModel } from "./model";
import type { ChatEntry, ToolResult } from "./model/types";
import { paypal } from "./paypal";
import type { ToolDef } from "./paypal/gateway";
import { getStoreRecords } from "./store-records";
import type { TraceStep } from "./types";
import { lruGet, visitor } from "./visitor";

export type RiskSignal = { finding: string; effect: "RAISES" | "LOWERS"; source: string };
export type RiskVerdict = { risk: "LOW" | "MEDIUM" | "HIGH"; score: number; headline: string; signals: RiskSignal[]; actions: string[] };
export type ShieldCheck = {
  order_id: string;
  invoice_id: string;
  status: "CHECKING" | "READY" | "ERROR";
  verdict?: RiskVerdict;
  trace: TraceStep[];
  model?: string;
  error?: string;
  at: string;
};

const MAX_TURNS = 8;
const REPLAY_STEP_MS = 350;

const SYSTEM = `You protect Juniper & Kiln, a two-person online shop paid through PayPal, from disputes before they happen. A buyer has just paid and the order has not shipped yet. Decide how likely this order is to end in a PayPal dispute or chargeback, and what the seller should do before shipping.

Read the PayPal order with get_order and the buyer's history with get_buyer_history, then call submit_risk exactly once.

What matters:
- Shipping somewhere other than the buyer's PayPal address, especially a package forwarder or a different recipient name. PayPal Seller Protection generally only covers items shipped to the address on the transaction.
- A first-time buyer, an unverified PayPal account, an expensive order, and paid overnight shipping together, which is the usual pattern of stolen-account fraud.
- Past disputes the buyer filed with this shop, and whether the shop's evidence contradicted them (for example a "not received" claim on a parcel signed for by the buyer). Say this plainly; it is the strongest signal.
- A repeat buyer with completed orders and no disputes lowers the risk.

Rules:
- Every signal must come from a tool result; name the tool in its source. Never invent facts.
- score is 0 to 100 (chance of a dispute, scaled). LOW under 30, MEDIUM 30 to 64, HIGH 65 and over.
- actions are 1 to 3 short, imperative steps the seller can take before shipping, cheapest first: for example message the buyer through PayPal to confirm the order, ship only to the address on the PayPal transaction, require signature confirmation, keep a packing photo, hold the parcel, or refund before shipping. For LOW risk, say to ship as normal.
- Be fair to the buyer: a single weak signal is not fraud. Explain it in the headline, in one sentence a busy seller reads first.`;

const SUBMIT_TOOL: ToolDef = {
  name: "submit_risk",
  description: "Submit the dispute-risk check for this order. Call once, after reading the order and the buyer's history.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["risk", "score", "headline", "signals", "actions"],
    properties: {
      risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      score: { type: "number", description: "0 to 100" },
      headline: { type: "string", description: "One sentence the seller reads first." },
      signals: {
        type: "array",
        description: "2 to 6 facts that decided it, raising or lowering the risk.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["finding", "effect", "source"],
          properties: {
            finding: { type: "string" },
            effect: { type: "string", enum: ["RAISES", "LOWERS"] },
            source: { type: "string", description: "Tool that returned this fact." },
          },
        },
      },
      actions: { type: "array", items: { type: "string" }, description: "1 to 3 steps before shipping." },
    },
  },
};

const HISTORY_TOOL: ToolDef = {
  name: "get_buyer_history",
  description:
    "Look up a buyer's history with the shop by their PayPal email: completed orders, and every dispute they have filed that Rebuttal handled, with what the shop's evidence showed (carrier delivery, signature) and how it ended.",
  input_schema: {
    type: "object",
    properties: { email: { type: "string", description: "The buyer's PayPal email address, from the order's payer." } },
    required: ["email"],
    additionalProperties: false,
  },
};

const VerdictSchema = z.object({
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  score: z.number().min(0).max(100),
  headline: z.string().min(1),
  signals: z.array(z.object({ finding: z.string(), effect: z.enum(["RAISES", "LOWERS"]), source: z.string() })).min(1),
  actions: z.array(z.string()).min(1).max(4),
});

// The buyer's history with the shop: completed orders, plus Rebuttal's memory of every
// dispute they filed, with the evidence the shop had and how it ended.
export async function getBuyerHistory(email: string) {
  const key = email.trim().toLowerCase();
  const order = PENDING_ORDERS.find((o) => o.buyer.email === key);
  const disputes = await Promise.all(
    listCases()
      .filter((c) => c.dispute.disputed_transactions[0]?.buyer?.email?.toLowerCase() === key)
      .map(async (c) => {
        const t = c.dispute.disputed_transactions[0];
        const store = await getStoreRecords(t.invoice_number ?? "");
        const f = "fulfillment" in store ? store.fulfillment : undefined;
        return {
          invoice_id: t.invoice_number,
          dispute_id: c.id,
          reason: c.dispute.reason,
          amount: c.dispute.dispute_amount,
          opened: c.dispute.create_time.slice(0, 10),
          paypal_status: c.dispute.status,
          shop_evidence: f
            ? { carrier: f.carrier, last_scan: f.carrier_events.at(-1)?.status ?? null, signature_required: f.signature_required, signed_by: f.signed_by }
            : null,
          rebuttal_assessment: c.recommendation ? { decision: c.recommendation.decision, headline: c.recommendation.headline } : null,
          outcome: c.outcome ? c.outcome.result : "OPEN",
        };
      }),
  );
  return {
    email: key,
    completed_orders: order?.prior_purchases ?? 0,
    disputes_filed: disputes.length,
    disputes,
  };
}

export async function assessOrder(orderId: string, opts: { model?: AgentModel; onStep?: (s: TraceStep) => void } = {}): Promise<{ verdict: RiskVerdict; trace: TraceStep[]; model: string }> {
  const model = opts.model ?? defaultModel();
  const gw = paypal();
  const trace: TraceStep[] = [];
  const step = (s: Omit<TraceStep, "at">) => {
    const full = { ...s, at: new Date().toISOString() };
    trace.push(full);
    opts.onStep?.(full);
  };
  const tools: ToolDef[] = [...gw.agentTools().filter((t) => t.name === "get_order"), HISTORY_TOOL, SUBMIT_TOOL];
  const history: ChatEntry[] = [{ role: "user", text: `PayPal order ${orderId} was just paid and has not shipped. Check its dispute risk and submit it.` }];

  let nudged = false;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await model.next({ system: SYSTEM, tools, history });
    if (res.stop === "refusal") throw new Error("The model declined to check this order.");
    if (res.stop === "max_tokens") throw new Error("The check ran out of output space.");
    history.push({ role: "assistant", turn: res });
    if (res.calls.length === 0) {
      if (nudged) throw new Error("The model finished without a risk check.");
      nudged = true;
      history.push({ role: "user", text: "Call submit_risk now." });
      continue;
    }
    const results: ToolResult[] = [];
    for (const use of res.calls) {
      const reply = (content: string, isError?: boolean) => results.push({ id: use.id, name: use.name, content, ...(isError ? { isError } : {}) });
      if (use.name === SUBMIT_TOOL.name) {
        const parsed = VerdictSchema.safeParse(use.input);
        if (parsed.success) {
          const v = { ...parsed.data, risk: bandOf(parsed.data.score) };
          step({ kind: "note", summary: `Risk: ${v.risk} (${Math.round(v.score)}/100)` });
          return { verdict: v, trace, model: `${model.provider}:${model.model}` };
        }
        reply(`Invalid risk check: ${parsed.error.message}`, true);
        continue;
      }
      try {
        const out = use.name === HISTORY_TOOL.name ? await getBuyerHistory(String(use.input.email ?? "")) : await gw.runTool(use.name, use.input);
        step({ kind: "tool", tool: use.name, input: use.input, summary: summarizeShield(use.name, out) });
        reply(JSON.stringify(out));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        step({ kind: "error", tool: use.name, input: use.input, summary: msg });
        reply(msg, true);
      }
    }
    history.push({ role: "tool", results });
  }
  throw new Error("The check did not finish within its step limit.");
}

// The score decides the band, so a model that says MEDIUM at 80 can't understate it.
const bandOf = (score: number): RiskVerdict["risk"] => (score >= 65 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW");

function summarizeShield(tool: string, out: unknown): string {
  const o = (out ?? {}) as Record<string, any>;
  if (tool === "get_order") {
    const pu = o.purchase_units?.[0];
    const a = pu?.shipping?.address;
    return `Order ${o.id}: $${pu?.amount?.value}, ${pu?.shipping?.options?.find((x: any) => x.selected)?.label ?? "shipping"}, ships to ${pu?.shipping?.name?.full_name ?? "?"} in ${a?.admin_area_2 ?? "?"}, ${a?.admin_area_1 ?? ""}`;
  }
  if (tool === "get_buyer_history") {
    const n = o.disputes_filed ?? 0;
    return `${o.completed_orders ?? 0} completed order${o.completed_orders === 1 ? "" : "s"}, ${n} past dispute${n === 1 ? "" : "s"}${n ? ` (${o.disputes.map((d: any) => d.invoice_id).join(", ")})` : ""}`;
  }
  return "Done";
}

// Per-visitor results in the simulator, like cases; the live sandbox has no orders yet.
const g = globalThis as unknown as { __rebuttalShield?: Map<string, Map<string, ShieldCheck>> };
function store(): Map<string, ShieldCheck> {
  g.__rebuttalShield ??= new Map();
  return lruGet(g.__rebuttalShield, `${visitor().mode}:${visitor().id}`, () => new Map());
}

export function resetShield() {
  g.__rebuttalShield?.delete(`${visitor().mode}:${visitor().id}`);
}

export type ShieldRow = ShieldCheck & { buyer: string; item: string; amount: string; ship_to: string };

export async function listShield(): Promise<ShieldRow[]> {
  const gw = paypal();
  const s = store();
  return Promise.all(
    (await gw.ordersAwaitingShipment()).map(async (o) => {
      const order = (await gw.runTool("get_order", { id: o.order_id })) as any;
      const pu = order.purchase_units?.[0];
      const a = pu?.shipping?.address;
      return {
        ...(s.get(o.order_id) ?? { ...o, status: "CHECKING" as const, trace: [], at: new Date().toISOString() }),
        buyer: [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" "),
        item: pu?.items?.[0]?.name ?? "",
        amount: pu?.amount?.value ?? "0",
        ship_to: `${pu?.shipping?.name?.full_name ?? ""}, ${a?.admin_area_2 ?? ""}, ${a?.admin_area_1 ?? ""}`,
      };
    }),
  );
}

// Marks the orders nobody has checked yet and returns their ids, so the caller can
// check them in the background.
export async function claimUnchecked(): Promise<string[]> {
  const s = store();
  const todo: string[] = [];
  for (const o of await paypal().ordersAwaitingShipment()) {
    if (s.has(o.order_id)) continue;
    s.set(o.order_id, { ...o, status: "CHECKING", trace: [], at: new Date().toISOString() });
    todo.push(o.order_id);
  }
  return todo;
}

// Runs (or replays) the check for one order and stores the result.
export async function runShield(orderId: string, opts: { fresh?: boolean; model?: AgentModel } = {}): Promise<ShieldCheck> {
  const s = store();
  const meta = (await paypal().ordersAwaitingShipment()).find((o) => o.order_id === orderId);
  if (!meta) throw new Error(`No order ${orderId} awaiting shipment.`);
  const base: ShieldCheck = { ...meta, status: "CHECKING", trace: [], at: new Date().toISOString() };
  s.set(orderId, base);
  const onStep = (st: TraceStep) => s.set(orderId, { ...s.get(orderId)!, trace: [...(s.get(orderId)?.trace ?? []), st] });
  try {
    await syncCases(); // dispute memory needs the current cases
    const order = (await paypal().runTool("get_order", { id: orderId })) as { payer?: { email_address?: string } };
    const memory = await getBuyerHistory(order.payer?.email_address ?? "");
    const key = shieldKey(meta.invoice_id, memory);
    const saved = opts.fresh ? null : loadCheck(key);
    if (saved) {
      onStep({ at: new Date().toISOString(), kind: "note", summary: `Saved check from ${saved.saved_at.slice(0, 10)} (${saved.model}). Re-check for a fresh one.` });
      for (const st of saved.trace) {
        await new Promise((r) => setTimeout(r, REPLAY_STEP_MS));
        onStep({ ...st, at: new Date().toISOString() });
      }
      return done(orderId, { status: "READY", verdict: saved.verdict, model: saved.model });
    }
    const out = await assessOrder(orderId, { model: opts.model, onStep });
    if (!opts.model) saveCheck(key, out);
    return done(orderId, { status: "READY", verdict: out.verdict, model: out.model });
  } catch (e) {
    return done(orderId, { status: "ERROR", error: e instanceof Error ? e.message : String(e) });
  }
}

function done(orderId: string, patch: Partial<ShieldCheck>): ShieldCheck {
  const s = store();
  const next = { ...s.get(orderId)!, ...patch, at: new Date().toISOString() };
  s.set(orderId, next);
  return next;
}

// Saved checks, like saved investigations: keyed by the order and the buyer's dispute
// memory, so a new dispute from the same buyer asks the model again.
const dir = () => path.join(process.env.REBUTTAL_CACHE_DIR ?? path.join(process.cwd(), "cache", "investigations"), "..", "shield");
function shieldKey(invoice: string, memory: Awaited<ReturnType<typeof getBuyerHistory>>) {
  const facts = { invoice, disputes: memory.disputes.map((d) => [d.invoice_id, d.reason, d.outcome]) };
  return `${invoice.replace(/[^A-Za-z0-9_-]/g, "")}-${crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 12)}`;
}
type SavedCheck = { key: string; saved_at: string; model: string; verdict: RiskVerdict; trace: TraceStep[] };
function loadCheck(key: string): SavedCheck | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${key}.json`), "utf8")) as SavedCheck;
  } catch {
    return null;
  }
}
function saveCheck(key: string, out: { verdict: RiskVerdict; trace: TraceStep[]; model: string }) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), `${key}.json`), JSON.stringify({ key, saved_at: new Date().toISOString(), ...out }, null, 2));
  } catch (e) {
    console.warn("Could not save shield check:", e instanceof Error ? e.message : e);
  }
}
