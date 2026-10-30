// Demo seller: "Juniper & Kiln", a two-person shop selling ceramics, leather goods and prints.
// Each scenario is one realistic dispute plus the data a seller would actually have:
// the PayPal order, the PayPal shipment tracker, PayPal transaction history, and the
// shop's own records (listing text, customer messages, carrier scan history).

import type { Dispute, DisputeReason } from "../types";

export type StoreRecord = {
  invoice_id: string;
  listing: { title: string; description: string; photos: string[] };
  customer_messages: Array<{ from: "buyer" | "seller"; at: string; text: string }>;
  fulfillment: {
    shipped_at: string | null;
    carrier: string | null;
    tracking_number: string | null;
    service: string;
    signature_required: boolean;
    signed_by: string | null;
    carrier_events: Array<{ at: string; status: string; location: string }>;
    packing_photo: boolean;
  };
  policies: { returns: string; shipping: string };
};

export type Scenario = {
  key: string;
  title: string;
  reason: DisputeReason;
  stage: Dispute["dispute_life_cycle_stage"];
  amount: string;
  buyer: { name: string; email: string; payer_id: string; address: string };
  item: { id: string; name: string; qty: number };
  buyer_messages_in_dispute: string[];
  order_age_days: number;
  store: Omit<StoreRecord, "invoice_id">;
  buyer_prior_purchases: number;
  tracker_status: "SHIPPED" | "DELIVERED" | null;
  // Days left for the seller to respond when the simulator files the dispute.
  due_in_days: number;
  // How the simulated buyer haggles when the agent negotiates a partial refund.
  buyer_negotiation?: BuyerPersona;
};

// The simulated buyer accepts any offer at or above `reservation` (never revealed to the
// agent), otherwise answers with the next ask and line, then lets PayPal decide.
export type BuyerPersona = { reservation: number; asks: number[]; counters: string[]; accept: string; walk_away: string };

export function personaFor(s: Scenario | undefined, amount: number): BuyerPersona {
  if (s?.buyer_negotiation) return s.buyer_negotiation;
  const r = (f: number) => Math.round(amount * f);
  return {
    reservation: r(0.35),
    asks: [r(0.6), r(0.45)],
    counters: [
      `That's too low for what happened. I'd accept $${r(0.6)}.`,
      `I can come down a bit, but not that far. $${r(0.45)} and we're done.`,
    ],
    accept: "Okay, that works for me. Thanks for sorting it out.",
    walk_away: "Then I'll let PayPal decide.",
  };
}

const daysAgo = (d: number, h = 10) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  t.setUTCHours(h, 12, 0, 0);
  return t.toISOString();
};

export const SHOP = {
  name: "Juniper & Kiln",
  returns:
    "Returns accepted within 30 days of delivery for unused items in original packaging. Buyer pays return shipping unless the item arrived damaged or not as described.",
  shipping:
    "Ships within 2 business days from Portland, OR. Orders over $100 ship with tracking and signature confirmation.",
};

export const SCENARIOS: Scenario[] = [
  {
    key: "JK-1042",
    due_in_days: 3,
    title: "Delivered with signature, buyer says it never arrived",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: "CHARGEBACK",
    amount: "184.00",
    buyer: { name: "Dana Whitfield", email: "dana.w@example.com", payer_id: "QX7BUYER1042", address: "418 Alder St, Apt 3, Denver, CO 80203" },
    item: { id: "LB-TOTE-TAN", name: "Hand-stitched leather tote, tan", qty: 1 },
    buyer_messages_in_dispute: ["I never received my bag. Tracking says delivered but nothing was at my door."],
    order_age_days: 19,
    buyer_prior_purchases: 0,
    tracker_status: "DELIVERED",
    store: {
      listing: {
        title: "Hand-stitched leather tote, tan",
        description: "Full-grain vegetable-tanned leather, saddle-stitched by hand. 14in x 12in x 5in.",
        photos: ["front", "interior", "stitching detail"],
      },
      customer_messages: [
        { from: "buyer", at: daysAgo(15), text: "Hi! Any update on shipping? Excited for the bag." },
        { from: "seller", at: daysAgo(15), text: "Shipped yesterday with UPS, tracking 1Z84A9E70347215522. Signature required." },
        { from: "buyer", at: daysAgo(11), text: "Thanks, got the notice that it's out for delivery today." },
      ],
      fulfillment: {
        shipped_at: daysAgo(16),
        carrier: "UPS",
        tracking_number: "1Z84A9E70347215522",
        service: "UPS Ground, signature required",
        signature_required: true,
        signed_by: "WHITFIELD",
        carrier_events: [
          { at: daysAgo(16, 17), status: "Picked up", location: "Portland, OR" },
          { at: daysAgo(13, 8), status: "Arrived at facility", location: "Commerce City, CO" },
          { at: daysAgo(11, 9), status: "Out for delivery", location: "Denver, CO" },
          { at: daysAgo(11, 14), status: "Delivered, signed by WHITFIELD, front desk", location: "418 Alder St, Denver, CO 80203" },
        ],
        packing_photo: true,
      },
      policies: { returns: SHOP.returns, shipping: SHOP.shipping },
    },
  },
  {
    key: "JK-1057",
    due_in_days: 9,
    buyer_negotiation: {
      reservation: 30,
      asks: [48, 36],
      counters: [
        "The chip isn't my only problem, the blue is much darker than in your photos. I'd settle for $48, half the order.",
        "I hear you on the glaze, but one mug's worth feels low for the hassle of all this. $36 and we're done.",
      ],
      accept: "Okay, that works for me. Thanks for sorting it out quickly.",
      walk_away: "Then I'll wait for PayPal to decide.",
    },
    title: "Mug arrived chipped, buyer wants a full refund",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    stage: "INQUIRY",
    amount: "96.00",
    buyer: { name: "Priya Raman", email: "priya.r@example.com", payer_id: "QX7BUYER1057", address: "77 Union Ave, Brooklyn, NY 11211" },
    item: { id: "CER-MUG-SET4", name: "Speckled stoneware mugs, set of 4", qty: 1 },
    buyer_messages_in_dispute: [
      "One of the four mugs arrived with a chip on the rim, and the glaze is a different blue than the photos. I want a full refund.",
    ],
    order_age_days: 12,
    buyer_prior_purchases: 1,
    tracker_status: "DELIVERED",
    store: {
      listing: {
        title: "Speckled stoneware mugs, set of 4",
        description:
          "Wheel-thrown stoneware, 12oz. Glaze is hand-applied, so color and speckling vary from piece to piece and may differ from photos. Dishwasher safe.",
        photos: ["set of four", "glaze close-up"],
      },
      customer_messages: [
        { from: "buyer", at: daysAgo(4), text: "One mug has a chip on the rim. Photo attached. The blue is also darker than I expected." },
      ],
      fulfillment: {
        shipped_at: daysAgo(10),
        carrier: "USPS",
        tracking_number: "9400111899223847562190",
        service: "USPS Ground Advantage",
        signature_required: false,
        signed_by: null,
        carrier_events: [
          { at: daysAgo(10, 16), status: "Accepted", location: "Portland, OR" },
          { at: daysAgo(6, 12), status: "Delivered, in/at mailbox", location: "Brooklyn, NY 11211" },
        ],
        packing_photo: false,
      },
      policies: { returns: SHOP.returns, shipping: SHOP.shipping },
    },
  },
  {
    key: "JK-1071",
    due_in_days: 2,
    title: "'Unauthorized' charge from a repeat customer",
    reason: "UNAUTHORISED",
    stage: "CHARGEBACK",
    amount: "142.00",
    buyer: { name: "Ellen Ortiz", email: "ellen.ortiz@example.com", payer_id: "QX7BUYER1071", address: "9 Harbor Rd, Portland, ME 04101" },
    item: { id: "CER-VASE-TALL", name: "Tall ash-glaze vase", qty: 1 },
    buyer_messages_in_dispute: ["I don't recognize this charge."],
    order_age_days: 30,
    buyer_prior_purchases: 4,
    tracker_status: "DELIVERED",
    store: {
      listing: { title: "Tall ash-glaze vase", description: "Wood-fired stoneware, 11in tall.", photos: ["vase"] },
      customer_messages: [
        { from: "buyer", at: daysAgo(29), text: "Ordering the tall vase to go with the bowls I bought in spring. Can you gift wrap it?" },
        { from: "seller", at: daysAgo(29), text: "Of course, it'll go out wrapped tomorrow!" },
        { from: "buyer", at: daysAgo(24), text: "It arrived and it's gorgeous, thank you!" },
      ],
      fulfillment: {
        shipped_at: daysAgo(28),
        carrier: "USPS",
        tracking_number: "9405511899223847561044",
        service: "USPS Priority Mail, signature required",
        signature_required: true,
        signed_by: "E ORTIZ",
        carrier_events: [
          { at: daysAgo(28, 16), status: "Accepted", location: "Portland, OR" },
          { at: daysAgo(25, 13), status: "Delivered, signed by E ORTIZ", location: "Portland, ME 04101" },
        ],
        packing_photo: true,
      },
      policies: { returns: SHOP.returns, shipping: SHOP.shipping },
    },
  },
  {
    key: "JK-1063",
    due_in_days: 12,
    title: "Untracked print never arrived",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: "INQUIRY",
    amount: "28.00",
    buyer: { name: "Marcus Lee", email: "marcus.lee@example.com", payer_id: "QX7BUYER1063", address: "2210 Pine St, Seattle, WA 98101" },
    item: { id: "PRT-RIVER-A4", name: "Risograph print 'River at Dusk', A4", qty: 1 },
    buyer_messages_in_dispute: ["It's been three weeks and the print hasn't come."],
    order_age_days: 24,
    buyer_prior_purchases: 0,
    tracker_status: null,
    store: {
      listing: { title: "Risograph print 'River at Dusk', A4", description: "Two-color risograph on 100lb paper. Ships flat in a rigid mailer.", photos: ["print"] },
      customer_messages: [],
      fulfillment: {
        shipped_at: daysAgo(22),
        carrier: "USPS",
        tracking_number: null,
        service: "USPS First-Class letter (no tracking)",
        signature_required: false,
        signed_by: null,
        carrier_events: [],
        packing_photo: false,
      },
      policies: { returns: SHOP.returns, shipping: SHOP.shipping },
    },
  },
];

// Seeded sandbox orders carry a suffix (JK-1042-AB12) because sandbox invoice IDs must be unique.
export const scenarioByKey = (key: string) => SCENARIOS.find((s) => s.key === key || key.startsWith(`${s.key}-`));
