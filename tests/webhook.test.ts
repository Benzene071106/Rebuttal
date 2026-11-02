import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/webhooks/paypal/route";

describe("PayPal webhook", () => {
  it("acknowledges non-dispute events without a signature check, so PayPal stops retrying them", async () => {
    delete process.env.PAYPAL_WEBHOOK_ID; // verification would throw (500) if it ran
    const res = await POST(new Request("http://x/api/webhooks/paypal", { method: "POST", body: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
  });
});
