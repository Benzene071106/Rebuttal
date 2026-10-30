// Shapes follow the PayPal Disputes and Orders APIs (subset of fields we use).

export type Money = { currency_code: string; value: string };

export type DisputeReason =
  | "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
  | "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
  | "UNAUTHORISED"
  | "CREDIT_NOT_PROCESSED"
  | "DUPLICATE_TRANSACTION"
  | "INCORRECT_AMOUNT"
  | "PAYMENT_BY_OTHER_MEANS"
  | "CANCELED_RECURRING_BILLING"
  | "PROBLEM_WITH_REMITTANCE"
  | "OTHER";

export type DisputeStatus =
  | "OPEN"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "OTHER";

export type DisputeMessage = { posted_by: "BUYER" | "SELLER" | "ARBITER"; time_posted: string; content: string };

export type Dispute = {
  dispute_id: string;
  create_time: string;
  update_time: string;
  reason: DisputeReason;
  status: DisputeStatus;
  dispute_amount: Money;
  dispute_life_cycle_stage: "INQUIRY" | "CHARGEBACK" | "PRE_ARBITRATION" | "ARBITRATION";
  dispute_channel?: string;
  seller_response_due_date?: string;
  disputed_transactions: Array<{
    seller_transaction_id: string;
    buyer_transaction_id?: string;
    create_time?: string;
    transaction_status?: string;
    gross_amount?: Money;
    invoice_number?: string;
    custom?: string;
    buyer?: { name?: string; email?: string; payer_id?: string };
    seller?: { merchant_id?: string; name?: string };
    items?: Array<{ item_id?: string; item_description?: string; item_quantity?: string }>;
  }>;
  messages?: DisputeMessage[];
  dispute_outcome?: { outcome_code: string; amount_refunded?: Money };
  offer?: { buyer_requested_amount?: Money; seller_offered_amount?: Money; offer_type?: string };
};

export type Decision = "FIGHT" | "OFFER" | "REFUND";

export type EvidenceType =
  | "PROOF_OF_FULFILLMENT"
  | "PROOF_OF_DELIVERY_SIGNATURE"
  | "ITEM_DESCRIPTION"
  | "RETURN_POLICY"
  | "PROOF_OF_RECEIPT_COPY"
  | "OTHER";

export type Recommendation = {
  decision: Decision;
  win_probability: number;
  headline: string;
  rationale: string;
  evidence: Array<{ type: EvidenceType; summary: string; source: string }>;
  response_to_paypal: string;
  tracking_carrier: string;
  tracking_number: string;
  offer_amount: number;
  offer_type: "REFUND" | "REFUND_WITH_RETURN" | "NONE";
  risks: string[];
  // The facts that drove the decision. Investigations saved before this field existed lack it.
  factors?: Array<{ finding: string; favors: "SELLER" | "BUYER"; weight: "HIGH" | "MEDIUM" | "LOW"; source: string }>;
};

export type TraceStep = {
  at: string;
  kind: "tool" | "note" | "error";
  tool?: string;
  input?: unknown;
  summary: string;
};

export type CaseStatus =
  | "NEW"
  | "ANALYZING"
  | "READY"
  | "SUBMITTED"
  | "WON"
  | "LOST"
  | "SETTLED"
  | "REFUNDED"
  | "ERROR";

export type CaseRecord = {
  id: string; // = dispute_id
  dispute: Dispute;
  status: CaseStatus;
  recommendation?: Recommendation;
  trace: TraceStep[];
  submitted?: { decision: Decision; at: string; response: string; offer_amount?: number; by?: "seller" | "autopilot" };
  outcome?: { result: "WON" | "LOST" | "SETTLED" | "REFUNDED"; amount_kept: number; amount_lost: number; at: string };
  error?: string;
  // How the case arrived: a PayPal dispute webhook, or the seller opening it from the inbox.
  source?: "webhook" | "inbox";
  // What autopilot did once the investigation finished, and which rule decided it.
  autopilot?: { action: "AUTO_REFUNDED" | "AUTO_FOUGHT" | "NEEDS_APPROVAL" | "FAILED"; reason: string; at: string };
  // Seller-facing alerts for this case, newest last.
  activity?: ActivityItem[];
  // The agent's partial-refund negotiation with the buyer, when the seller started one.
  negotiation?: Negotiation;
  updated_at: string;
};

export type NegotiationTurn = {
  at: string;
  from: "AGENT" | "BUYER";
  text: string;
  // AGENT: the refund offered with this message. BUYER: the refund the buyer asked for.
  amount?: number;
  // AGENT only: why it made this move (shown to the seller, never sent to the buyer),
  // and whether the model or the rule-based fallback chose it.
  reasoning?: string;
  by?: "model" | "rules";
};

export type Negotiation = {
  status: "ACTIVE" | "WAITING_FOR_BUYER" | "SETTLED" | "HANDED_BACK";
  // The most the seller lets the agent refund. Enforced in code, never shown to the buyer.
  max_refund: number;
  turns: NegotiationTurn[];
  note?: string;
};

export type ActivityItem = { at: string; text: string; tone: "info" | "good" | "warn" | "bad" };

// Seller rules for autopilot. Autopilot never acts above max_auto_amount, whatever the other rules say.
export type AutopilotRules = {
  enabled: boolean;
  // Accept the claim when the AI recommends a refund and the amount is at most this.
  auto_refund_max: number;
  // Send evidence on its own when the AI recommends fighting with at least this win estimate (0 turns it off).
  auto_fight_min_win: number;
  max_auto_amount: number;
  // The negotiator may refund at most this share of the disputed amount.
  negotiate_max_pct: number;
};
