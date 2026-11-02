import { paypalSecret } from "../auth/sellers";
import { liveReadOnly, sandboxAvailable as visitorSandboxAvailable, setVisitorMode, visitor, type Mode } from "../visitor";
import type { PayPalGateway } from "./gateway";
import { mockGateway } from "./mock";
import { sandboxGateway } from "./sandbox";

export type { Mode };

// Each visitor picks Simulator or Live sandbox from the inbox (kept in a cookie, see
// visitor.ts), so a hosted demo opens on the simulator and still shows the live sandbox.
const g = globalThis as unknown as { __rebuttalSandbox?: PayPalGateway; __rebuttalSellerGateways?: Map<string, PayPalGateway> };

export function sandboxAvailable(): boolean {
  return visitorSandboxAvailable(visitor().seller);
}

export function currentMode(): Mode {
  return visitor().mode;
}

export function setMode(mode: Mode) {
  setVisitorMode(mode);
}

export { liveReadOnly };

export function paypal(): PayPalGateway {
  if (currentMode() === "mock") return mockGateway;
  const seller = visitor().seller;
  if (seller) {
    // A signed-in seller only ever reaches their own PayPal account, never the demo's.
    if (!seller.paypal) throw new Error("Connect your PayPal account first (Account page).");
    const key = `${seller.id}:${seller.paypal.connected_at}`;
    g.__rebuttalSellerGateways ??= new Map();
    let gw = g.__rebuttalSellerGateways.get(key);
    if (!gw) {
      gw = sandboxGateway(seller.paypal.client_id, paypalSecret(seller.paypal), { env: seller.paypal.env, webhookId: seller.paypal.webhook_id });
      g.__rebuttalSellerGateways.set(key, gw);
      // Keep the cache small; a dropped gateway just signs in to PayPal again.
      if (g.__rebuttalSellerGateways.size > 200) g.__rebuttalSellerGateways.delete(g.__rebuttalSellerGateways.keys().next().value as string);
    }
    return gw;
  }
  g.__rebuttalSandbox ??= sandboxGateway(process.env.PAYPAL_CLIENT_ID!, process.env.PAYPAL_CLIENT_SECRET!);
  return g.__rebuttalSandbox;
}

// Drops the cached PayPal client so the next call signs in to PayPal again, used when
// PayPal says the access token expired.
export function resetPayPalClient() {
  const seller = visitor().seller;
  if (seller?.paypal) g.__rebuttalSellerGateways?.delete(`${seller.id}:${seller.paypal.connected_at}`);
  else g.__rebuttalSandbox = undefined;
}
