// In-memory stand-in for the PayPal sandbox, returning the same JSON shapes as the
// Disputes, Orders, Shipment Tracking and Transaction Search APIs. Used for local
// development and tests when sandbox credentials or network access are missing.

import { personaFor, SCENARIOS, SHOP, type Scenario } from "../demo/scenarios";
import type { Dispute } from "../types";
import type { EvidenceSubmission, PayPalGateway } from "./gateway";
import { sharedToolDefs } from "./toolkit";
import { lruGet, visitor } from "../visitor";

type MockRow = {
  scenario: Scenario;
  dispute: Dispute;
  order: Record<string, unknown>;
  captureId: string;
  tracker: Record<string, unknown> | null;
  submissions: unknown[];
  // Haggling state of the simulated buyer: how many counters they have made, and a
  // reply that "arrives" a moment after the seller's message, like a real buyer.
  buyerRound: number;
  pendingReply?: { due: number; apply: () => void };
};

type MockState = { rows: Map<string, MockRow>; nextSeq: number; filed: Set<string> };

// One simulator per visitor, so judges trying the demo at the same time don't see each other's clicks.
const g = globalThis as unknown as { __rebuttalMock?: Map<string, MockState> };

function id(prefix: string, seed: number, len: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let x = seed * 2654435761;
  let out = prefix;
  while (out.length < len) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += chars[x % chars.length];
  }
  return out;
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

function build(s: Scenario, seq: number): MockRow {
  const disputeId = `PP-D-${27800 + seq}`;
  const orderId = id("", seq + 11, 17);
  const captureId = id("", seq + 97, 17);
  const created = iso(s.order_age_days * DAY);
  const filed = iso(2 * DAY);
  const amount = { currency_code: "USD", value: s.amount };
  const dispute: Dispute = {
    dispute_id: disputeId,
    create_time: filed,
    update_time: filed,
    reason: s.reason,
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: amount,
    dispute_life_cycle_stage: s.stage,
    dispute_channel: s.stage === "CHARGEBACK" ? "EXTERNAL" : "INTERNAL",
    seller_response_due_date: new Date(Date.now() + s.due_in_days * DAY).toISOString(),
    disputed_transactions: [
      {
        seller_transaction_id: captureId,
        create_time: created,
        transaction_status: "COMPLETED",
        gross_amount: amount,
        invoice_number: s.key,
        buyer: { name: s.buyer.name, email: s.buyer.email, payer_id: s.buyer.payer_id },
        seller: { merchant_id: "JUNIPERKILN01", name: SHOP.name },
        items: [{ item_id: s.item.id, item_description: s.item.name, item_quantity: String(s.item.qty) }],
      },
    ],
    messages: s.buyer_messages_in_dispute.map((content) => ({ posted_by: "BUYER" as const, time_posted: filed, content })),
  };
  // "418 Alder St, Apt 3, Denver, CO 80203" -> street, city, state, zip
  const parts = s.buyer.address.split(", ");
  const [state, zip] = parts.at(-1)!.split(" ");
  const city = parts.at(-2);
  const street = parts.slice(0, -2).join(", ");
  const order = {
    id: orderId,
    intent: "CAPTURE",
    status: "COMPLETED",
    create_time: created,
    payer: { name: { given_name: s.buyer.name.split(" ")[0], surname: s.buyer.name.split(" ")[1] }, email_address: s.buyer.email, payer_id: s.buyer.payer_id },
    purchase_units: [
      {
        reference_id: "default",
        invoice_id: s.key,
        amount: { ...amount, breakdown: { item_total: amount } },
        items: [{ name: s.item.name, sku: s.item.id, quantity: String(s.item.qty), unit_amount: amount }],
        shipping: {
          name: { full_name: s.buyer.name },
          address: { address_line_1: street, admin_area_2: city, admin_area_1: state, postal_code: zip, country_code: "US" },
        },
        payments: { captures: [{ id: captureId, status: "COMPLETED", amount, create_time: created, final_capture: true }] },
      },
    ],
  };
  const f = s.store.fulfillment;
  const tracker =
    s.tracker_status && f.tracking_number
      ? {
          transaction_id: captureId,
          tracking_number: f.tracking_number,
          status: s.tracker_status,
          carrier: f.carrier,
          shipment_date: f.shipped_at?.slice(0, 10),
          last_updated_time: f.carrier_events.at(-1)?.at,
        }
      : null;
  return { scenario: s, dispute, order, captureId, tracker, submissions: [], buyerRound: 0 };
}

function state(): MockState {
  g.__rebuttalMock ??= new Map();
  return lruGet(g.__rebuttalMock, visitor().id, () => {
    const st: MockState = { rows: new Map(), nextSeq: 0, filed: new Set() };
    // Start with three disputes in the inbox; the fourth (a $28 print) arrives live in the
    // demo through the simulated webhook, small enough for autopilot to refund on its own.
    for (const s of SCENARIOS.slice(0, 3)) addScenario(st, s);
    return st;
  });
}

function addScenario(st: MockState, s: Scenario) {
  const row = build(s, st.nextSeq++);
  st.rows.set(row.dispute.dispute_id, row);
  st.filed.add(s.key);
  return row;
}

function row(disputeId: string) {
  const r = state().rows.get(disputeId);
  if (!r) throw new Error(`RESOURCE_NOT_FOUND: dispute ${disputeId}`);
  settle(r);
  return r;
}

const BUYER_REPLY_MS = 1800;

// Delivers the simulated buyer's reply once its moment has come.
function settle(r: MockRow) {
  if (r.pendingReply && Date.now() >= r.pendingReply.due) {
    const p = r.pendingReply;
    r.pendingReply = undefined;
    p.apply();
  }
}

// The simulated buyer answers the seller's latest offer: accept it if it reaches their
// private minimum, otherwise counter, and after their last counter let PayPal decide.
function scheduleBuyerReply(r: MockRow) {
  const offered = Number(r.dispute.offer?.seller_offered_amount?.value ?? 0);
  const persona = personaFor(r.scenario, Number(r.dispute.dispute_amount.value));
  const say = (content: string) => [...(r.dispute.messages ?? []), { posted_by: "BUYER" as const, time_posted: new Date().toISOString(), content }];
  r.pendingReply = {
    due: Date.now() + BUYER_REPLY_MS,
    apply: () => {
      if (offered >= persona.reservation) {
        touch(r, {
          status: "RESOLVED",
          messages: say(persona.accept),
          dispute_outcome: { outcome_code: "RESOLVED_WITH_PAYOUT", amount_refunded: { currency_code: r.dispute.dispute_amount.currency_code, value: offered.toFixed(2) } },
        });
      } else if (r.buyerRound < persona.asks.length) {
        const ask = persona.asks[r.buyerRound];
        const line = persona.counters[r.buyerRound];
        r.buyerRound++;
        touch(r, {
          status: "WAITING_FOR_SELLER_RESPONSE",
          messages: say(line),
          offer: { ...r.dispute.offer, buyer_requested_amount: { currency_code: r.dispute.dispute_amount.currency_code, value: ask.toFixed(2) } },
        });
      } else {
        touch(r, { status: "UNDER_REVIEW", messages: say(persona.walk_away) });
      }
    },
  };
}

function touch(r: MockRow, patch: Partial<Dispute>) {
  r.dispute = { ...r.dispute, ...patch, update_time: new Date().toISOString() };
}

export function resetMock() {
  g.__rebuttalMock?.delete(visitor().id);
}

export const mockGateway: PayPalGateway = {
  mode: "mock",

  agentTools: sharedToolDefs,

  async runTool(name, input) {
    const st = state();
    const all = [...st.rows.values()];
    switch (name) {
      case "get_dispute":
        return row(String(input.dispute_id)).dispute;
      case "get_order": {
        const r = all.find((x) => x.order.id === input.id);
        if (!r) throw new Error(`RESOURCE_NOT_FOUND: order ${input.id}`);
        return r.order;
      }
      case "get_shipment_tracking": {
        const r = all.find((x) => x.captureId === input.transaction_id || x.order.id === input.order_id);
        if (!r) throw new Error("RESOURCE_NOT_FOUND: transaction");
        return { trackers: r.tracker ? [r.tracker] : [] };
      }
      case "list_transactions": {
        // Transaction Search: return this buyer's purchase history with the shop.
        const r = input.transaction_id ? all.find((x) => x.captureId === input.transaction_id) : undefined;
        const rows = r ? [r] : all;
        const details = rows.flatMap((x) => {
          const prior = Array.from({ length: x.scenario.buyer_prior_purchases }, (_, i) => ({
            transaction_info: {
              transaction_id: id("", i + 500 + x.scenario.key.length, 17),
              transaction_event_code: "T0006",
              transaction_initiation_date: iso((x.scenario.order_age_days + 40 * (i + 1)) * DAY),
              transaction_amount: { currency_code: "USD", value: (38 + i * 21).toFixed(2) },
              transaction_status: "S",
              invoice_id: `JK-0${900 + i * 17}`,
            },
            payer_info: { account_id: x.scenario.buyer.payer_id, email_address: x.scenario.buyer.email },
            shipping_info: { name: x.scenario.buyer.name, address: x.scenario.buyer.address },
          }));
          return [
            {
              transaction_info: {
                transaction_id: x.captureId,
                transaction_event_code: "T0006",
                transaction_initiation_date: x.dispute.disputed_transactions[0].create_time,
                transaction_amount: x.dispute.dispute_amount,
                transaction_status: "S",
                invoice_id: x.scenario.key,
              },
              payer_info: { account_id: x.scenario.buyer.payer_id, email_address: x.scenario.buyer.email },
              shipping_info: { name: x.scenario.buyer.name, address: x.scenario.buyer.address },
            },
            ...prior,
          ];
        });
        // For one transaction we also return the same payer's earlier purchases,
        // which is what a seller sees when they search by payer.
        return { transaction_details: details, total_items: details.length };
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  },

  async orderIdForInvoice(invoiceId) {
    const r = [...state().rows.values()].find((x) => x.scenario.key === invoiceId);
    return r ? String(r.order.id) : null;
  },

  async listDisputes() {
    return [...state().rows.values()].map((r) => (settle(r), r.dispute));
  },

  async getDispute(id) {
    return row(id).dispute;
  },

  async provideEvidence(id, ev: EvidenceSubmission) {
    const r = row(id);
    r.submissions.push({ kind: "evidence", ...ev });
    touch(r, {
      status: "UNDER_REVIEW",
      messages: [...(r.dispute.messages ?? []), { posted_by: "SELLER", time_posted: new Date().toISOString(), content: ev.notes }],
    });
  },

  async makeOffer(id, offer) {
    const r = row(id);
    r.submissions.push({ kind: "offer", ...offer });
    touch(r, {
      status: "WAITING_FOR_BUYER_RESPONSE",
      offer: { ...r.dispute.offer, seller_offered_amount: { currency_code: offer.currency, value: offer.amount }, offer_type: offer.type },
      messages: [...(r.dispute.messages ?? []), { posted_by: "SELLER", time_posted: new Date().toISOString(), content: offer.note }],
    });
    if (offer.negotiating) scheduleBuyerReply(r);
  },

  async sendMessage(id, message) {
    const r = row(id);
    r.submissions.push({ kind: "message", message });
    touch(r, { messages: [...(r.dispute.messages ?? []), { posted_by: "SELLER", time_posted: new Date().toISOString(), content: message }] });
  },

  async acceptClaim(id, note) {
    const r = row(id);
    r.submissions.push({ kind: "accept", note });
    touch(r, { status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: r.dispute.dispute_amount } });
  },

  async addTracking(transactionId, t) {
    const r = [...state().rows.values()].find((x) => x.captureId === transactionId);
    if (!r) throw new Error("RESOURCE_NOT_FOUND: transaction");
    if (r.tracker?.tracking_number === t.tracking_number) return "exists";
    r.tracker = { transaction_id: transactionId, tracking_number: t.tracking_number, status: "SHIPPED", carrier: t.carrier, last_updated_time: new Date().toISOString() };
    return "added";
  },

  async verifyWebhook() {
    return true;
  },

  async simulateRuling(id, outcome) {
    const r = row(id);
    const offered = r.dispute.offer?.seller_offered_amount;
    if (r.dispute.status === "WAITING_FOR_BUYER_RESPONSE" && offered) {
      // Sandbox buyer accepts the seller's offer.
      touch(r, { status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_WITH_PAYOUT", amount_refunded: offered } });
      return;
    }
    touch(r, {
      status: "RESOLVED",
      dispute_outcome:
        outcome === "SELLER_FAVOR"
          ? { outcome_code: "RESOLVED_SELLER_FAVOUR" }
          : { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: r.dispute.dispute_amount },
    });
  },

  async fileTestDispute(scenarioKey) {
    const st = state();
    const s = scenarioKey ? SCENARIOS.find((x) => x.key === scenarioKey) : SCENARIOS.find((x) => !st.filed.has(x.key));
    if (!s) {
      // Every scenario is already in the inbox: file a fresh copy of the first one.
      return addScenario(st, SCENARIOS[0]).dispute;
    }
    return addScenario(st, s).dispute;
  },
};

