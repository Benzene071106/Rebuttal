// One in-flight action per dispute. Investigating and sending a response to PayPal
// share this lock, so two clicks (or autopilot + a seller click, or bulk approve + a
// single approve) can never send PayPal two responses, and a finishing investigation
// can never overwrite a response that was sent while it ran.

import { visitor } from "./visitor";

export class CaseBusyError extends Error {
  readonly status = 409;
}

const held = new Map<string, { what: string; done: Promise<void> }>();

// Simulator dispute IDs repeat across visitors, so the key is per visitor and mode.
const keyFor = (caseId: string) => `${visitor().mode === "mock" ? visitor().id : "sandbox"}:${caseId}`;

export async function withCaseLock<T>(caseId: string, what: string, fn: () => Promise<T>): Promise<T> {
  const key = keyFor(caseId);
  const busy = held.get(key)?.what;
  if (busy) throw new CaseBusyError(busy === what ? `${what} is already running for this dispute.` : `Wait: ${busy.toLowerCase()} is still running for this dispute.`);
  let release = () => {};
  held.set(key, { what, done: new Promise<void>((r) => (release = r)) });
  try {
    return await fn();
  } finally {
    held.delete(key);
    release();
  }
}

// Resolves once nothing is running for the dispute (at once if nothing is).
export async function caseIdle(caseId: string): Promise<void> {
  for (let h = held.get(keyFor(caseId)); h; h = held.get(keyFor(caseId))) await h.done;
}
