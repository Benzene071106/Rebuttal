import { liveReadOnly, setVisitorMode, visitor, type Mode } from "../visitor";
import type { PayPalGateway } from "./gateway";
import { mockGateway } from "./mock";
import { sandboxGateway } from "./sandbox";

export type { Mode };

// Each visitor picks Simulator or Live sandbox from the inbox (kept in a cookie, see
// visitor.ts), so a hosted demo opens on the simulator and still shows the live sandbox.
const g = globalThis as unknown as { __rebuttalSandbox?: PayPalGateway };

export function sandboxAvailable(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
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
  g.__rebuttalSandbox ??= sandboxGateway(process.env.PAYPAL_CLIENT_ID!, process.env.PAYPAL_CLIENT_SECRET!);
  return g.__rebuttalSandbox;
}

// Drops the cached sandbox client so the next call signs in to PayPal again, used when
// PayPal says the access token expired.
export function resetPayPalClient() {
  g.__rebuttalSandbox = undefined;
}
