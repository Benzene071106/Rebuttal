// One turn of AG Studio's agent framework, answered by Gemini.
//
// AG Studio (the AG Grid dashboard component) runs its own agents in the browser: a lead
// agent that delegates to data, page, widget and planning agents, each with Studio's tools
// for building and filtering the dashboard. Studio never calls a model itself; it hands an
// adapter one turn at a time (conversation items, instructions, tool schemas) and expects
// the model's output items back. This file is the server half of that adapter: it turns
// Studio's items into a Gemini request and Gemini's answer back into Studio's items.

import { GoogleGenAI, FunctionCallingConfigMode, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { DEFAULT_GEMINI_MODEL, withRetry } from "./gemini";

// The shapes Studio sends and expects (ag-studio's AgLlmRequest / AgAiOutputItem), kept
// local so the server bundle never imports the browser package.
type InputText = { type: "text"; text: string };
export type StudioItem =
  | { kind: "input"; type: "message"; role: "user" | "system"; content: Array<InputText | { type: string }> }
  | { kind: "output"; type: "message"; role: "assistant"; content: Array<{ type: "text"; text: string } | { type: "refusal"; refusal: string }> }
  | { kind: "output"; type: "function_call"; callId: string; name: string; arguments: string }
  | { kind?: "input"; type: "function_call_output"; callId: string; output: string }
  | { kind: "output"; type: "reasoning" };
export type StudioTurnRequest = {
  input: StudioItem[];
  instructions?: string;
  tools?: Array<{ name: string; description: string; parameters: unknown; kind?: string }>;
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?: { type: "text" } | { type: "json"; name: string; description?: string; schema: unknown };
};
export type StudioOutputItem =
  | { id: string; kind: "output"; type: "message"; role: "assistant"; status: "completed"; content: Array<{ type: "text"; text: string; annotations: [] }> }
  | { id: string; kind: "output"; type: "function_call"; callId: string; name: string; arguments: string; status: "completed" };

// Gemini 3 wants each function call's thought signature back when the conversation is
// replayed. Studio keeps the conversation in the browser, so the signature rides along in
// the call id ("<id>~<signature>") and is split off again here. Older calls without one use
// Gemini's documented placeholder.
const SIG_SEP = "~";
const NO_SIGNATURE = "skip_thought_signature_validator";

export function toGemini(req: StudioTurnRequest): { system: string; contents: Content[] } {
  const system: string[] = [];
  if (req.instructions) system.push(req.instructions);
  const names = new Map<string, string>();
  const contents: Content[] = [];
  const push = (role: "user" | "model", part: Part) => {
    const last = contents[contents.length - 1];
    if (last?.role === role) last.parts!.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const item of req.input ?? []) {
    if (item.type === "message" && item.kind === "input") {
      const text = item.content.filter((c): c is InputText => c.type === "text").map((c) => c.text).join("\n");
      if (!text) continue;
      if (item.role === "system") system.push(text);
      else push("user", { text });
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("\n");
      if (text) push("model", { text });
    } else if (item.type === "function_call") {
      names.set(item.callId, item.name);
      const [id, sig] = item.callId.split(SIG_SEP);
      let args: Record<string, unknown> = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        // keep {} for arguments the model sent malformed
      }
      push("model", { functionCall: { id, name: item.name, args }, thoughtSignature: sig || NO_SIGNATURE });
    } else if (item.type === "function_call_output") {
      let value: unknown = item.output;
      try {
        value = JSON.parse(item.output);
      } catch {
        // plain-text tool result
      }
      push("user", { functionResponse: { id: item.callId.split(SIG_SEP)[0], name: names.get(item.callId) ?? "tool", response: { output: value } } });
    }
  }
  if (req.responseFormat?.type === "json" && req.tools?.length) {
    system.push(`When you give your final answer, reply with JSON only, matching this schema (${req.responseFormat.name}): ${JSON.stringify(req.responseFormat.schema)}`);
  }
  if (!contents.length) contents.push({ role: "user", parts: [{ text: "Continue." }] });
  return { system: system.join("\n\n"), contents };
}

// Small models sometimes flatten a one-of-objects argument to its tag: Studio's delegate_to
// wants type: { id: "page" } and gets type: "page". When the schema has exactly one object
// option whose required "id" enum holds that string, wrap it back.
type Schema = { type?: string; properties?: Record<string, Schema>; anyOf?: Schema[]; oneOf?: Schema[]; enum?: unknown[]; required?: string[] };
export function repairArgs(schema: unknown, args: Record<string, unknown>): Record<string, unknown> {
  const props = (schema as Schema | undefined)?.properties;
  if (!props) return args;
  const out = { ...args };
  for (const [k, v] of Object.entries(out)) {
    const options = props[k]?.anyOf ?? props[k]?.oneOf;
    if (typeof v !== "string" || !options) continue;
    const hit = options.filter((o) => o.type === "object" && o.properties?.id?.enum?.includes(v));
    if (hit.length === 1) out[k] = { id: v };
  }
  return out;
}

export function fromGemini(res: GenerateContentResponse, newId: () => string, schemas: Map<string, unknown> = new Map()): StudioOutputItem[] {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const out: StudioOutputItem[] = [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (text) out.push({ id: newId(), kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
  for (const p of parts) {
    if (!p.functionCall?.name) continue;
    const id = p.functionCall.id ?? newId();
    out.push({
      id: newId(),
      kind: "output",
      type: "function_call",
      callId: p.thoughtSignature ? `${id}${SIG_SEP}${p.thoughtSignature}` : id,
      name: p.functionCall.name,
      arguments: JSON.stringify(repairArgs(schemas.get(p.functionCall.name), (p.functionCall.args ?? {}) as Record<string, unknown>)),
      status: "completed",
    });
  }
  return out;
}

// Gemini rejects recursive schemas whose loop runs through required fields (Studio's
// layout tools describe nested columns and rows that way). Making any property that leads
// to a $ref optional breaks the loop; Studio still validates every tool call itself and
// sends errors back to the model.
const hasRef = (v: unknown): boolean =>
  Array.isArray(v) ? v.some(hasRef) : v !== null && typeof v === "object" ? "$ref" in v || Object.values(v).some(hasRef) : false;
export function geminiSafeSchema(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(geminiSafeSchema);
  if (v === null || typeof v !== "object") return v;
  const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, geminiSafeSchema(x)])) as Record<string, unknown>;
  const props = o.properties as Record<string, unknown> | undefined;
  if (props && Array.isArray(o.required)) o.required = (o.required as string[]).filter((k) => !hasRef(props[k]));
  return o;
}

function toolConfig(choice: StudioTurnRequest["toolChoice"]) {
  if (!choice || choice === "auto") return undefined;
  if (choice === "none") return { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } };
  if (choice === "required") return { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } };
  return { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [choice.name] } };
}

type GenerateClient = { models: { generateContent(params: any): Promise<GenerateContentResponse> } };

export async function runStudioTurn(req: StudioTurnRequest, opts: { client?: GenerateClient; models?: string[]; retryDelaysMs?: number[] } = {}) {
  const client = opts.client ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // Flash-lite answers fastest on the free tier and handles Studio's tools; a model that is
  // rate limited or slow is skipped quickly, because one dashboard takes several turns.
  const models = opts.models ?? (process.env.GEMINI_STUDIO_MODELS?.split(",").map((m) => m.trim()).filter(Boolean) ?? [DEFAULT_GEMINI_MODEL, "gemini-flash-lite-latest", "gemini-3.5-flash"]);
  const { system, contents } = toGemini(req);
  const tools = (req.tools ?? []).filter((t) => (t.kind ?? "client") !== "provided");
  const json = req.responseFormat?.type === "json" && !tools.length ? req.responseFormat : null;
  let seq = 0;
  let lastError: unknown;
  let empty: string | null = null;
  for (const model of models) {
    try {
      const res = await withRetry(
        () =>
          client.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: system || undefined,
              temperature: 0.2,
              maxOutputTokens: 8192,
              ...(tools.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: geminiSafeSchema(t.parameters) })) }] } : {}),
              ...(tools.length ? { toolConfig: toolConfig(req.toolChoice) } : {}),
              ...(json ? { responseMimeType: "application/json", responseJsonSchema: json.schema } : {}),
              abortSignal: AbortSignal.timeout(45_000),
            },
          }),
        opts.retryDelaysMs ?? [], // normally no waiting here: the next model is the retry
      );
      const output = fromGemini(res, () => `st_${Date.now().toString(36)}_${++seq}`, new Map(tools.map((t) => [t.name, t.parameters])));
      // Flash-lite now and then answers with nothing at all, which Studio would take as
      // "done" halfway through a build. Treat that as a failed turn and ask the next model.
      if (!output.length) {
        empty = model;
        continue;
      }
      const um = res.usageMetadata;
      return {
        model,
        output,
        usage: um ? { inputTokens: um.promptTokenCount ?? 0, outputTokens: um.candidatesTokenCount ?? 0, totalTokens: um.totalTokenCount ?? 0 } : undefined,
      };
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      // A bad request is ours to fix, not a reason to try another model.
      if (status === 400) throw e;
    }
  }
  // Every model that answered said nothing: pass that on rather than failing the run.
  if (empty) return { model: empty, output: [] as StudioOutputItem[], usage: undefined };
  throw lastError;
}
