// Gemini adapter (default model). Uses the free tier of the Gemini API through the
// official @google/genai SDK, with function calling over the same JSON schemas the
// PayPal Agent Toolkit publishes.

import { GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import type { ToolDef } from "../paypal/gateway";
import type { AgentModel, ChatEntry, ModelTurn, ToolCall } from "./types";

// gemini-2.5-flash is closed to new API keys, and on 2026-10-07 the larger 3.x flash
// models were often overloaded (503) or never answered on the free tier. Flash-lite
// answered in about a second, so it leads; the others are tried if it fails.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_FALLBACKS = ["gemini-3.5-flash", "gemini-flash-lite-latest"];
const REQUEST_TIMEOUT_MS = 45_000;

type GenerateClient = { models: { generateContent(params: any): Promise<GenerateContentResponse> } };

export function geminiModel(
  opts: { apiKey?: string; model?: string; fallbacks?: string[]; client?: GenerateClient; retryDelaysMs?: number[]; timeoutMs?: number } = {},
): AgentModel {
  const primary = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const fallbacks = opts.fallbacks ?? (process.env.GEMINI_FALLBACK_MODELS?.split(",").map((m) => m.trim()).filter(Boolean) ?? DEFAULT_GEMINI_FALLBACKS);
  const candidates = [primary, ...fallbacks.filter((m) => m !== primary)];
  let client = opts.client;
  const delays = opts.retryDelaysMs ?? [2_000, 5_000, 12_000];
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let seq = 0;
  // Index of the model in use. Once a model fails we stay on the next one for the rest
  // of the investigation instead of hammering the one that is down.
  let current = 0;

  const self: AgentModel = {
    provider: "gemini",
    model: primary,
    async next({ system, tools, history }) {
      client ??= new GoogleGenAI({ apiKey: opts.apiKey ?? process.env.GEMINI_API_KEY });
      for (;;) {
        const model = candidates[current];
        const call = () =>
          client!.models.generateContent({
            model,
            contents: toContents(history),
            config: {
              systemInstruction: system,
              // 0 so the same facts give the same answer as far as the model allows.
              temperature: 0,
              maxOutputTokens: 8192,
              tools: [{ functionDeclarations: tools.map(toDeclaration) }],
              abortSignal: AbortSignal.timeout(timeoutMs),
            },
          });
        try {
          const res = await withRetry(call, delays);
          self.model = model;
          return fromResponse(res, () => `gen_${++seq}`);
        } catch (e) {
          if (current >= candidates.length - 1 || !isModelUnavailable(e)) throw e;
          current++;
        }
      }
    },
  };
  return self;
}

// Worth moving to the next model: overloaded, retired, rate limited, or no answer in time.
function isModelUnavailable(e: unknown) {
  if (e instanceof RateLimitError) return true;
  const status = (e as { status?: number }).status;
  if (status === 404 || status === 429 || status === 500 || status === 503) return true;
  const name = (e as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError" || /aborted|timed? ?out/i.test(e instanceof Error ? e.message : "");
}

function toDeclaration(t: ToolDef) {
  return { name: t.name, description: t.description, parametersJsonSchema: t.input_schema };
}

export function toContents(history: ChatEntry[]): Content[] {
  return history.map((e): Content => {
    if (e.role === "user") return { role: "user", parts: [{ text: e.text }] };
    if (e.role === "assistant") return e.turn.raw as Content;
    return {
      role: "user",
      parts: e.results.map((r): Part => {
        let value: unknown = r.content;
        try {
          value = JSON.parse(r.content);
        } catch {
          // plain text result
        }
        return {
          functionResponse: {
            ...(r.id.startsWith("gen_") ? {} : { id: r.id }),
            name: r.name,
            response: r.isError ? { error: value } : { output: value },
          },
        };
      }),
    };
  });
}

export function fromResponse(res: GenerateContentResponse, newId: () => string): ModelTurn {
  if (res.promptFeedback?.blockReason) return { calls: [], stop: "refusal", raw: { role: "model", parts: [{ text: "" }] } };
  const cand = res.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const raw: Content = parts.length ? { role: "model", parts } : { role: "model", parts: [{ text: "(no output)" }] };
  const calls: ToolCall[] = parts
    .filter((p) => p.functionCall?.name)
    .map((p) => ({ id: p.functionCall!.id ?? newId(), name: p.functionCall!.name!, input: (p.functionCall!.args ?? {}) as Record<string, unknown> }));
  const reason = String(cand?.finishReason ?? "STOP");
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(reason)) return { calls: [], stop: "refusal", raw };
  if (reason === "MAX_TOKENS" && calls.length === 0) return { calls: [], stop: "max_tokens", raw };
  return { calls, stop: calls.length ? "tool_use" : "end", raw };
}

// The free tier allows only a few requests per minute, so back off on 429 and on
// transient 5xx errors, honouring the server's suggested retry delay when it gives one.
export async function withRetry<T>(fn: () => Promise<T>, delays: number[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status;
      const retryable = status === 429 || status === 500 || status === 503;
      if (!retryable || attempt >= delays.length) {
        if (status === 429) throw new RateLimitError(e instanceof Error ? e.message : String(e));
        throw e;
      }
      const hinted = /"retryDelay":\s*"(\d+)s"/.exec(e instanceof Error ? e.message : "")?.[1];
      const wait = hinted ? Math.min(Number(hinted) * 1000, 60_000) : delays[attempt];
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export class RateLimitError extends Error {
  constructor(detail: string) {
    super(`The AI model's free-tier rate limit was reached. Try again in a minute. (${detail.slice(0, 200)})`);
    this.name = "RateLimitError";
  }
}
