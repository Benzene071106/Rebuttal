import { describe, expect, it } from "vitest";
import { fromGemini, geminiSafeSchema, repairArgs, runStudioTurn, toGemini, type StudioTurnRequest } from "@/lib/model/studio-turn";

const delegate = {
  type: "object",
  properties: {
    type: { anyOf: [{ type: "object", properties: { id: { type: "string", enum: ["data"] } }, required: ["id"] }, { type: "object", properties: { id: { type: "string", enum: ["page"] }, pageId: { type: "string" } }, required: ["id"] }] },
    instructions: { type: "string" },
  },
  required: ["type", "instructions"],
};

describe("AG Studio turns on Gemini", () => {
  it("maps Studio's conversation to Gemini contents, keeping thought signatures", () => {
    const req: StudioTurnRequest = {
      instructions: "You build dashboards.",
      input: [
        { kind: "input", type: "message", role: "system", content: [{ type: "text", text: "Schema: disputes" }] },
        { kind: "input", type: "message", role: "user", content: [{ type: "text", text: "Refunds by claim" }] },
        { kind: "output", type: "function_call", callId: "c1~SIG", name: "view_report", arguments: "{}" },
        { type: "function_call_output", callId: "c1~SIG", output: '{"success":true}' },
      ],
    };
    const { system, contents } = toGemini(req);
    expect(system).toBe("You build dashboards.\n\nSchema: disputes");
    expect(contents[1].parts?.[0]).toEqual({ functionCall: { id: "c1", name: "view_report", args: {} }, thoughtSignature: "SIG" });
    expect(contents[2].parts?.[0].functionResponse).toEqual({ id: "c1", name: "view_report", response: { output: { success: true } } });
  });

  it("returns text and tool calls as Studio output items", () => {
    const res = { candidates: [{ content: { role: "model", parts: [{ text: "On it." }, { functionCall: { id: "g1", name: "delegate_to", args: { type: "page", instructions: "add a KPI" } }, thoughtSignature: "S2" }] } }] };
    const out = fromGemini(res as never, () => "x", new Map([["delegate_to", delegate]]));
    expect(out[0]).toMatchObject({ type: "message", content: [{ text: "On it." }] });
    expect(out[1]).toMatchObject({ type: "function_call", callId: "g1~S2", name: "delegate_to" });
    // "page" is wrapped back into the object form Studio's schema asks for.
    expect(JSON.parse((out[1] as { arguments: string }).arguments).type).toEqual({ id: "page" });
  });

  it("leaves arguments alone when they already match or are ambiguous", () => {
    expect(repairArgs(delegate, { type: { id: "data" }, instructions: "x" }).type).toEqual({ id: "data" });
    expect(repairArgs(delegate, { type: "nope", instructions: "x" }).type).toBe("nope");
  });

  it("makes recursive required fields optional for Gemini", () => {
    const tree = { $defs: { Node: { type: "object", properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/Node" } } }, required: ["name", "children"] } } };
    expect((geminiSafeSchema(tree) as typeof tree).$defs.Node.required).toEqual(["name"]);
  });

  it("falls through to the next model when one is rate limited", async () => {
    const seen: string[] = [];
    const client = {
      models: {
        async generateContent(p: { model: string }) {
          seen.push(p.model);
          if (p.model === "a") throw Object.assign(new Error("quota"), { status: 429 });
          return { candidates: [{ content: { parts: [{ text: "ok" }] } }] };
        },
      },
    };
    const r = await runStudioTurn({ input: [{ kind: "input", type: "message", role: "user", content: [{ type: "text", text: "hi" }] }] }, { client: client as never, models: ["a", "b"] });
    expect(seen).toEqual(["a", "b"]);
    expect(r.model).toBe("b");
  });
});

describe("empty answers", () => {
  it("asks the next model when one returns nothing", async () => {
    const client = { models: { generateContent: async (p: { model: string }) => ({ candidates: [{ content: { parts: p.model === "a" ? [] : [{ text: "ok" }] } }] }) } };
    const r = await runStudioTurn({ input: [{ kind: "input", type: "message", role: "user", content: [{ type: "text", text: "hi" }] }] }, { client: client as never, models: ["a", "b"] });
    expect(r.model).toBe("b");
  });
});
