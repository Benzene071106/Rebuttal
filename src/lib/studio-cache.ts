// Saved AG Studio turns. One dashboard takes 10 to 25 model turns, and on Gemini's free
// tier that is 3 to 6 minutes, too long for a judge clicking a suggested question. With
// STUDIO_RECORD=1 every real Gemini turn is saved under cache/studio; afterwards the same
// turn (same conversation, same dashboard, same tools) is answered from the file. Ids,
// timestamps and thread names that change from run to run are left out of the key, so
// a replay of a suggested question follows the recorded run turn by turn. Anything else a
// visitor asks, or the same question on a changed dashboard, misses and runs live.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = () => process.env.STUDIO_CACHE_DIR ?? path.join(process.cwd(), "cache", "studio");

// Per-item fields of Studio's conversation that differ between two runs of the same chat.
const VOLATILE_ITEM_KEYS = new Set(["id", "callId", "status"]);
const PATTERNS: Array<[RegExp, string]> = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>"],
  [/st_[a-z0-9]+_\d+(~[A-Za-z0-9+/=_-]+)?/g, "<call>"],
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<time>"],
  [/\b1[6-9]\d{11}\b/g, "<ms>"],
];

function strings(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strings);
  if (typeof v === "string") return PATTERNS.reduce((s, [re, to]) => s.replace(re, to), v);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, strings(x)]));
}

export function normalize(req: { input?: unknown[] } & Record<string, unknown>): unknown {
  const input = (req.input ?? []).map((item) =>
    item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([k]) => !VOLATILE_ITEM_KEYS.has(k))) : item,
  );
  return strings({ ...req, input });
}

export function studioKey(request: { input?: unknown[] } & Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(normalize(request))).digest("hex").slice(0, 24);
}

export function loadStudioTurn(key: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${key}.json`), "utf8")).response;
  } catch {
    return null;
  }
}

export function saveStudioTurn(key: string, response: unknown) {
  if (process.env.STUDIO_RECORD !== "1") return;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${key}.json`), JSON.stringify({ key, saved_at: new Date().toISOString(), response }, null, 1));
}
