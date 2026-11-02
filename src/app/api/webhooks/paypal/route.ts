import { handlePayPalWebhook } from "@/lib/webhooks/paypal";
import type { Visitor } from "@/lib/visitor";

export const maxDuration = 300;

// PayPal calls this for CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED on the shared demo
// sandbox. A new dispute is investigated in the background and the autopilot rules
// applied, so either PayPal already has an answer or an approval is waiting.
// Sellers' own accounts deliver to /api/webhooks/paypal/<seller id> instead.
const SERVER: Visitor = { id: "server", mode: "sandbox" };

export async function POST(req: Request) {
  return handlePayPalWebhook(req, SERVER);
}
