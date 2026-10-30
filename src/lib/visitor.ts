// Per-visitor demo state. On the hosted demo several judges can be clicking at once,
// so each browser gets its own simulator (disputes, cases, Reset demo) and its own
// Simulator / Live sandbox choice, keyed by a cookie. The live sandbox is one real
// PayPal account, so its cases stay shared.

import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export type Mode = "mock" | "sandbox";
export type Visitor = { id: string; mode: Mode };

const VISITOR_COOKIE = "rebuttal_visitor";
const MODE_COOKIE = "rebuttal_mode";
const YEAR = 60 * 60 * 24 * 365;

const als = new AsyncLocalStorage<Visitor>();

function sandboxAvailable(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

// The starting mode for a new visitor. PAYPAL_MODE=mock opens on the simulator;
// without it, sandbox credentials win.
export function defaultMode(): Mode {
  return process.env.PAYPAL_MODE === "mock" || !sandboxAvailable() ? "mock" : "sandbox";
}

// Code running outside a request (a PayPal webhook, a script) acts as the server
// itself: the shared state in the default mode. Decided on first use, not at import,
// so the environment (PAYPAL_MODE in tests and scripts) is read when it is final.
let server: Visitor | undefined;

export function visitor(): Visitor {
  return als.getStore() ?? (server ??= { id: "server", mode: defaultMode() });
}

export function runAs<T>(v: Visitor, fn: () => T): T {
  return als.run(v, fn);
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

// Wraps a route handler so everything it calls sees this browser's visitor id and
// mode, and the browser gets a visitor cookie on its first request.
export function withVisitor<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const existing = readCookie(req, VISITOR_COOKIE);
    const id = existing && /^[a-f0-9-]{36}$/.test(existing) ? existing : crypto.randomUUID();
    const wanted = readCookie(req, MODE_COOKIE);
    const mode: Mode = wanted === "sandbox" && sandboxAvailable() ? "sandbox" : wanted === "mock" ? "mock" : defaultMode();
    const v: Visitor = { id, mode };
    const res = await als.run(v, () => handler(req, ...rest));
    if (id !== existing) res.headers.append("Set-Cookie", cookie(VISITOR_COOKIE, id));
    if (v.mode !== wanted) res.headers.append("Set-Cookie", cookie(MODE_COOKIE, v.mode));
    return res;
  };
}

function cookie(name: string, value: string) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax; HttpOnly${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

// Switches this visitor's mode for the rest of the request; withVisitor writes the cookie.
export function setVisitorMode(mode: Mode) {
  if (mode === "sandbox" && !sandboxAvailable()) throw new Error("PayPal sandbox credentials are not configured on this server.");
  visitor().mode = mode;
}

// Keeps at most `max` entries, dropping the least recently used, so the per-visitor
// simulators of past judges don't pile up in memory.
export function lruGet<V>(map: Map<string, V>, key: string, make: () => V, max = 500): V {
  let v = map.get(key);
  if (v !== undefined) map.delete(key);
  else v = make();
  map.set(key, v);
  while (map.size > max) map.delete(map.keys().next().value as string);
  return v;
}

// The live sandbox is one shared PayPal account. On the hosted demo it is view-only
// (cases, saved investigations, outcomes), so one visitor can't change it for others;
// set LIVE_SANDBOX_WRITABLE=1 to act on it, as local development does by default.
export function liveReadOnly(): boolean {
  if (process.env.LIVE_SANDBOX_WRITABLE === "1") return false;
  return process.env.NODE_ENV === "production";
}

export const READ_ONLY_MESSAGE = "The live PayPal sandbox is view-only on the hosted demo. Switch to the Simulator to try every step.";

// True when this visitor is looking at the live sandbox and may not change it.
export function viewOnly(): boolean {
  return visitor().mode === "sandbox" && liveReadOnly();
}

export function assertWritable() {
  if (viewOnly()) throw new Error(READ_ONLY_MESSAGE);
}
