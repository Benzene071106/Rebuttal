import { z } from "zod";
import { json, sameOrigin } from "@/lib/auth/http";
import { clearPayPal, getSeller, paypalSecret, publicSeller, savePayPal } from "@/lib/auth/sellers";
import { ConnectError, connectPayPal, disconnectPayPal } from "@/lib/paypal/connect";
import { visitor, withVisitor } from "@/lib/visitor";

const ConnectSchema = z.object({
  env: z.enum(["sandbox", "live"]),
  client_id: z.string().trim().min(10).max(200),
  secret: z.string().trim().min(10).max(200),
});

// Connects the signed-in seller's own PayPal REST app.
export const POST = withVisitor(async (req: Request) => {
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const ref = visitor().seller;
  if (!ref) return json({ error: "Sign in first." }, 401);
  const parsed = ConnectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Paste the Client ID and Secret from your PayPal app." }, 400);
  const { env, client_id, secret } = parsed.data;
  try {
    const before = await getSeller(ref.id);
    const result = await connectPayPal(ref.id, env, client_id, secret);
    // Replacing a different app: take Rebuttal's webhook off the old one.
    if (before?.paypal && (before.paypal.client_id !== client_id || before.paypal.env !== env)) {
      await disconnectPayPal(before.paypal.env, before.paypal.client_id, paypalSecret(before.paypal), before.paypal.webhook_id);
    }
    const seller = await savePayPal(ref.id, { env, client_id, secret, webhook_id: result.webhook_id });
    return json({ seller: publicSeller(seller), warnings: result.warnings });
  } catch (e) {
    if (e instanceof ConnectError) return json({ error: e.message }, 400);
    console.error("PayPal connect failed:", e);
    return json({ error: "Could not reach PayPal. Try again in a minute." }, 502);
  }
});

export const DELETE = withVisitor(async (req: Request) => {
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const ref = visitor().seller;
  if (!ref) return json({ error: "Sign in first." }, 401);
  const seller = await getSeller(ref.id);
  if (seller?.paypal) await disconnectPayPal(seller.paypal.env, seller.paypal.client_id, paypalSecret(seller.paypal), seller.paypal.webhook_id);
  await clearPayPal(ref.id);
  return json({ ok: true });
});
