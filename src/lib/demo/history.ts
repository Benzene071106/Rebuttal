// Six months of closed disputes for the demo shop, so the Insights charts, the outcomes
// ledger and the dispute memory look like a real seller's account instead of four rows.
// Generated from a fixed seed: every visitor sees the same history, and it is marked
// as simulated everywhere it is shown. None of these are open, so nothing here needs
// the seller's attention or adds to money at risk.

import type { CaseRecord, Decision, DisputeReason, Recommendation } from "../types";

const DAY = 86_400_000;

// Small deterministic PRNG (mulberry32), so the history is identical on every server.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Avery", "Jordan", "Sam", "Riley", "Morgan", "Casey", "Jamie", "Quinn", "Taylor", "Rowan", "Elliot", "Harper", "Noah", "Maya", "Leo", "Iris", "Owen", "Nina", "Theo", "Zara", "Felix", "Ada", "Milo", "Ruth", "Kai", "Lena", "Omar", "Vera", "Hugo", "Tess"];
const LAST = ["Brooks", "Nguyen", "Patel", "Kowalski", "Okafor", "Lindqvist", "Moreau", "Haddad", "Silva", "Brennan", "Yamada", "Fischer", "Castillo", "Duarte", "Abara", "Novak", "Quinlan", "Rossi", "Sato", "Vance"];
const ITEMS: Array<[string, string, number, number]> = [
  ["PRT-CARD-6", "Letterpress card set of 6", 18, 2],
  ["CER-COASTER", "Stoneware coasters, pair", 24, 0],
  ["PRT-MINI", "Risograph mini print", 22, 2],
  ["LB-KEYFOB", "Leather key fob", 28, 1],
  ["CER-MUG-SET2", "Speckled stoneware mugs, set of 2", 48, 0],
  ["CER-BOWL-LG", "Large serving bowl, celadon", 86, 0],
  ["CER-VASE-BUD", "Bud vase trio", 54, 0],
  ["CER-PLATE-4", "Dinner plates, set of 4", 132, 0],
  ["LB-WALLET", "Leather card wallet", 42, 1],
  ["LB-BELT-BRN", "Hand-stitched belt, brown", 68, 1],
  ["LB-TOTE-BLK", "Leather tote, black", 196, 1],
  ["LB-BAG-WKND", "Leather weekender bag, walnut", 248, 1],
  ["LB-SATCHEL", "Leather satchel, tan", 214, 1],
  ["PRT-RIVER-A3", "Risograph print, A3", 32, 2],
  ["PRT-SET-3", "Risograph print set of 3", 58, 2],
  ["PRT-MAP-A2", "Hand-printed city map, A2", 74, 2],
  ["CER-TEAPOT", "Ash-glaze teapot", 118, 0],
  ["LB-JOURNAL", "Leather journal cover", 36, 1],
  ["CER-LAMP", "Stoneware table lamp", 312, 0],
  ["LB-DUFFEL", "Waxed canvas and leather duffel", 386, 1],
];
const REASONS: Array<[DisputeReason, number]> = [
  ["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 0.42],
  ["MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", 0.3],
  ["UNAUTHORISED", 0.18],
  ["CREDIT_NOT_PROCESSED", 0.06],
  ["DUPLICATE_TRANSACTION", 0.04],
];
const CARRIERS = ["USPS", "UPS", "FEDEX"];

// Buyers who disputed more than once; the dispute memory on Protect lists them first.
const REPEATERS = [
  { name: "Corey Haldane", email: "c.haldane@example.com", times: 3 },
  { name: "Mira Solberg", email: "mira.solberg@example.com", times: 2 },
  { name: "Trent Akers", email: "trent.akers@example.com", times: 2 },
];

export const HISTORY_SIZE = 50;

export function historyCases(now = Date.now()): CaseRecord[] {
  const r = rng(20261101);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const reason = (): DisputeReason => {
    let x = r();
    for (const [k, w] of REASONS) if ((x -= w) <= 0) return k;
    return REASONS[0][0];
  };
  const buyers: Array<{ name: string; email: string }> = [];
  for (const rep of REPEATERS) for (let i = 0; i < rep.times; i++) buyers.push(rep);
  while (buyers.length < HISTORY_SIZE) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (buyers.some((b) => b.name === name)) continue;
    buyers.push({ name, email: `${name.toLowerCase().replace(" ", ".")}@example.com` });
  }
  // Shuffle so the repeat disputers are spread over the months.
  for (let i = buyers.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [buyers[i], buyers[j]] = [buyers[j], buyers[i]];
  }

  return buyers.map((buyer, i): CaseRecord => {
    const [sku, item, price] = pick(ITEMS);
    const why = buyer.email.startsWith("c.haldane") ? "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" : reason();
    const amount = price + (r() < 0.3 ? Math.round(r() * 12) : 0);
    const filedDaysAgo = 8 + Math.floor((i / HISTORY_SIZE) * 172 + r() * 4);
    const filed = new Date(now - filedDaysAgo * DAY);
    const closed = new Date(Math.min(filed.getTime() + (5 + Math.floor(r() * 30)) * DAY, now - DAY));
    const tracked = why === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" ? r() < 0.85 : r() < 0.6;
    const signed = tracked && amount > 150 && r() < 0.7;

    // What the agent recommended, roughly how it does on the live demo cases.
    let decision: Decision;
    let win: number;
    if (why === "DUPLICATE_TRANSACTION" || why === "CREDIT_NOT_PROCESSED" || (amount < 40 && r() < 0.7)) {
      decision = "REFUND";
      win = 0.1 + r() * 0.2;
    } else if (why === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" && r() < 0.55) {
      decision = "OFFER";
      win = 0.45 + r() * 0.25;
    } else if (tracked || why === "UNAUTHORISED") {
      decision = "FIGHT";
      win = signed ? 0.85 + r() * 0.1 : 0.55 + r() * 0.3;
    } else {
      decision = r() < 0.5 ? "REFUND" : "OFFER";
      win = 0.3 + r() * 0.2;
    }
    const offer = decision === "OFFER" ? Math.round(amount * (0.2 + r() * 0.15)) : 0;
    const byAutopilot = (decision === "REFUND" && amount <= 30) || (decision === "FIGHT" && win >= 0.88 && amount <= 250 && r() < 0.8);

    let result: NonNullable<CaseRecord["outcome"]>["result"];
    let kept: number;
    if (decision === "REFUND") {
      result = "REFUNDED";
      kept = 0;
    } else if (decision === "OFFER") {
      const accepted = r() < 0.8;
      result = accepted ? "SETTLED" : r() < 0.5 ? "WON" : "LOST";
      kept = accepted ? amount - offer : result === "WON" ? amount : 0;
    } else {
      result = r() < win ? "WON" : "LOST";
      kept = result === "WON" ? amount : 0;
    }

    const id = `PP-D-${26100 + i * 7}`;
    const invoice = `JK-${String(700 + i * 6).padStart(4, "0")}`;
    const value = amount.toFixed(2);
    const carrier = pick(CARRIERS);
    const rec: Recommendation = {
      decision,
      win_probability: Math.round(win * 100) / 100,
      headline:
        decision === "FIGHT"
          ? signed
            ? `${carrier} shows it delivered and signed for, so fight it.`
            : tracked
              ? `${carrier} tracking shows delivery, so fight it.`
              : "The payment matches the buyer's usual device and address, so fight it."
          : decision === "OFFER"
            ? `Offer a $${offer} partial refund; the item matches the listing but the buyer may have a point.`
            : "Refund it: fighting costs more time than the order is worth.",
      rationale: "Simulated past dispute, generated for the demo's history.",
      evidence: tracked ? [{ type: signed ? "PROOF_OF_DELIVERY_SIGNATURE" : "PROOF_OF_FULFILLMENT", summary: `${carrier} ${signed ? "delivered, signed for" : "delivered"}`, source: "get_shipment_tracking" }] : [],
      response_to_paypal: decision === "FIGHT" ? "The order was shipped with tracking and delivered to the buyer's PayPal address." : "We have refunded the buyer as requested.",
      tracking_carrier: tracked ? carrier : "",
      tracking_number: tracked ? `${carrier === "UPS" ? "1Z" : "9400"}${String(1e9 + i * 7919).slice(0, 10)}` : "",
      offer_amount: offer,
      offer_type: decision === "OFFER" ? "REFUND" : "NONE",
      risks: [],
      factors: [
        tracked
          ? { finding: signed ? "Carrier shows signed delivery" : "Carrier shows delivery", favors: "SELLER", weight: signed ? "HIGH" : "MEDIUM", source: "get_shipment_tracking" }
          : { finding: "No carrier scan after pickup", favors: "BUYER", weight: "MEDIUM", source: "get_shipment_tracking" },
        { finding: `$${value} order`, favors: amount < 40 ? "BUYER" : "SELLER", weight: "LOW", source: "get_order" },
      ],
    };
    const total = { currency_code: "USD", value };
    return {
      id,
      history: true,
      dispute: {
        dispute_id: id,
        create_time: filed.toISOString(),
        update_time: closed.toISOString(),
        reason: why,
        status: "RESOLVED",
        dispute_amount: total,
        dispute_life_cycle_stage: why === "UNAUTHORISED" ? "CHARGEBACK" : "INQUIRY",
        dispute_channel: why === "UNAUTHORISED" ? "EXTERNAL" : "INTERNAL",
        disputed_transactions: [
          {
            seller_transaction_id: `HIST${String(i).padStart(13, "0")}`,
            create_time: new Date(filed.getTime() - 12 * DAY).toISOString(),
            transaction_status: "COMPLETED",
            gross_amount: total,
            invoice_number: invoice,
            buyer: { name: buyer.name, email: buyer.email },
            items: [{ item_id: sku, item_description: item, item_quantity: "1" }],
          },
        ],
        messages: [],
      },
      status: result,
      recommendation: rec,
      trace: [{ at: filed.toISOString(), kind: "note", summary: "Simulated past dispute from the demo shop's history. The live demo disputes are the ones still open." }],
      submitted: { decision, at: new Date(filed.getTime() + DAY).toISOString(), response: rec.response_to_paypal, offer_amount: offer || undefined, by: byAutopilot ? "autopilot" : "seller" },
      outcome: { result, amount_kept: kept, amount_lost: amount - kept, at: closed.toISOString() },
      activity: byAutopilot
        ? [
            { at: filed.toISOString(), text: `PayPal webhook: ${buyer.name} opened a $${value} dispute.`, tone: "info" },
            {
              at: new Date(filed.getTime() + 60_000).toISOString(),
              text: decision === "REFUND" ? `Autopilot refunded $${value}: within your auto-refund rule.` : `Autopilot sent the evidence: win chance ${Math.round(win * 100)}%, above your threshold.`,
              tone: "good",
            },
          ]
        : undefined,
      autopilot: byAutopilot ? { action: decision === "REFUND" ? "AUTO_REFUNDED" : "AUTO_FOUGHT", reason: "Within the seller's autopilot rules.", at: new Date(filed.getTime() + 60_000).toISOString() } : undefined,
      updated_at: closed.toISOString(),
    };
  });
}
