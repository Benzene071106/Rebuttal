// One in-flight action per dispute. Investigating and sending a response to PayPal
// share this lock, so two clicks (or autopilot + a seller click, or bulk approve + a
// single approve) can never send PayPal two responses, and a finishing investigation
// can never overwrite a response that was sent while it ran.

import { visitor } from "./visitor";

export class CaseBusyError extends Error {
  readonly status = 409;
}

const held = new Map<string, string>();

// Simulator dispute IDs repeat across visitors, so the key is per visitor and mode.
const keyFor = (caseId: string) => `${visitor().mode === "mock" ? visitor().id : "sandbox"}:${caseId}`;

export async function withCaseLock<T>(caseId: string, what: string, fn: () => Promise<T>): Promise<T> {
  const key = keyFor(caseId);
  const busy = held.get(key);
  if (busy) throw new CaseBusyError(busy === what ? `${what} is already running for this dispute.` : `Wait: ${busy.toLowerCase()} is still running for this dispute.`);
  held.set(key, what);
  try {
    return await fn();
  } finally {
    held.delete(key);
  }
}
