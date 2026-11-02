import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeDispute } from "../src/lib/agent";
import { runAnalysis } from "../src/lib/analysis";
import { resetCases, syncCases } from "../src/lib/cases";
import { cacheKey, loadInvestigation, saveInvestigation } from "../src/lib/investigation-cache";
import { geminiModel, withRetry } from "../src/lib/model/gemini";
import { paypal } from "../src/lib/paypal";
import { resetMock } from "../src/lib/paypal/mock";

process.env.PAYPAL_MODE = "mock";

const rec = {
  decision: "FIGHT", win_probability: 0.85, headline: "Fight it", rationale: "Signed delivery.",
  evidence: [{ type: "PROOF_OF_DELIVERY_SIGNATURE", summary: "Signed by WHITFIELD", source: "get_store_records" }],
  response_to_paypal: "Delivered and signed.", tracking_carrier: "UPS", tracking_number: "1Z84A9E70347215522",
  offer_amount: 0, offer_type: "NONE", risks: [],
};

// Fake @google/genai client: replays function calls, the way Gemini returns them.
function fakeGemini(script: Array<Array<{ name: string; args: Record<string, unknown> }>>) {
  const calls: any[] = [];
  let i = 0;
  return {
    calls,
    models: {
      generateContent: async (params: any) => {
        calls.push(structuredClone(params));
        const fc = script[i++] ?? [];
        const parts = fc.length ? fc.map((f) => ({ functionCall: { name: f.name, args: f.args }, thoughtSignature: `sig${i}` })) : [{ text: "Done." }];
        return { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] } as any;
      },
    },
  };
}

describe("Gemini adapter", () => {
  beforeEach(() => resetMock());

  it("drives the agent loop with function calls and returns signatures and results verbatim", async () => {
    const [d] = await paypal().listDisputes();
    const txn = d.disputed_transactions[0];
    const client = fakeGemini([
      [{ name: "get_dispute", args: { dispute_id: d.dispute_id } }, { name: "get_store_records", args: { invoice_id: txn.invoice_number } }],
      [{ name: "submit_recommendation", args: rec }],
    ]);
    const out = await analyzeDispute(d, { model: geminiModel({ client, model: "gemini-test" }) });
    expect(out.recommendation.decision).toBe("FIGHT");
    expect(out.model).toBe("gemini:gemini-test");

    const first = client.calls[0];
    expect(first.config.tools[0].functionDeclarations.map((f: any) => f.name)).toEqual(
      expect.arrayContaining(["get_dispute", "get_order", "get_shipment_tracking", "list_transactions", "get_store_records", "submit_recommendation"]),
    );
    expect(first.config.tools[0].functionDeclarations[0].parametersJsonSchema.type).toBe("object");

    const second = client.calls[1].contents;
    expect(second[1].role).toBe("model");
    expect(second[1].parts[0].thoughtSignature).toBe("sig1");
    expect(second[2].parts.map((p: any) => p.functionResponse.name)).toEqual(["get_dispute", "get_store_records"]);
    expect(second[2].parts[0].functionResponse.response.output.dispute_id).toBe(d.dispute_id);
  });

  it("retries rate-limit errors, then reports them plainly", async () => {
    let n = 0;
    const ok = await withRetry(async () => {
      if (n++ < 2) throw Object.assign(new Error("quota"), { status: 429 });
      return "ok";
    }, [1, 1, 1]);
    expect(ok).toBe("ok");
    await expect(withRetry(async () => { throw Object.assign(new Error("quota"), { status: 429 }); }, [1])).rejects.toThrow("rate limit");
    await expect(withRetry(async () => { throw Object.assign(new Error("bad"), { status: 400 }); }, [1])).rejects.toThrow("bad");
  });
});

describe("Gemini fallback", () => {
  const okTurn = { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" }] };
  const sys = { system: "s", tools: [], history: [{ role: "user" as const, text: "hello" }] };
  // A client whose models fail in the given way; the rest answer.
  function flaky(fail: Record<string, () => Error>) {
    const tried: string[] = [];
    return {
      tried,
      models: {
        generateContent: async (p: any) => {
          tried.push(p.model);
          if (fail[p.model]) throw fail[p.model]();
          return okTurn as any;
        },
      },
    };
  }
  const status = (n: number) => () => Object.assign(new Error(`HTTP ${n}`), { status: n });
  const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

  it.each([
    ["429 rate limit", status(429)],
    ["503 overloaded", status(503)],
    ["timeout", timeout],
  ])("moves to the fallback model on %s", async (_label, err) => {
    const client = flaky({ primary: err });
    const m = geminiModel({ client, model: "primary", fallbacks: ["backup"], retryDelaysMs: [1] });
    await m.next(sys);
    expect(client.tried.at(-1)).toBe("backup");
    expect(m.model).toBe("backup");
  });

  it("sends temperature 0", async () => {
    let temp: number | undefined;
    const client = { models: { generateContent: async (p: any) => ((temp = p.config.temperature), okTurn as any) } };
    await geminiModel({ client, model: "a", fallbacks: [] }).next(sys);
    expect(temp).toBe(0);
  });

  it("does not hop models on a bad request, and throws once every model failed", async () => {
    const bad = flaky({ primary: status(400) });
    await expect(geminiModel({ client: bad, model: "primary", fallbacks: ["backup"], retryDelaysMs: [1] }).next(sys)).rejects.toThrow("HTTP 400");
    expect(bad.tried).toEqual(["primary"]);
    const down = flaky({ primary: status(503), backup: timeout });
    await expect(geminiModel({ client: down, model: "primary", fallbacks: ["backup"], retryDelaysMs: [1] }).next(sys)).rejects.toThrow();
  });

  it("uses the saved analysis, with a visible note, when every model fails", async () => {
    process.env.REBUTTAL_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rebuttal-cache-"));
    process.env.GEMINI_API_KEY = "test-key-not-real";
    process.env.GEMINI_MODEL = "primary";
    process.env.GEMINI_FALLBACK_MODELS = "backup";
    resetMock();
    await resetCases();
    const [c] = await syncCases();
    saveInvestigation(c.dispute, { model: "gemini:x", recommendation: rec as any, trace: [] });
    // No network here, so a fresh run fails on every model.
    const out = await runAnalysis(c.id, undefined, { fresh: true });
    expect(out.status).toBe("READY");
    expect(out.recommendation?.decision).toBe("FIGHT");
    expect(out.notice).toMatch(/saved analysis/);
    expect(out.trace[0].summary).toMatch(/saved analysis/);
    for (const k of ["REBUTTAL_CACHE_DIR", "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_MODELS"]) delete process.env[k];
  }, 60_000);
});

describe("investigation cache", () => {
  it("replays a saved investigation for the same order under a new dispute ID", async () => {
    process.env.REBUTTAL_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rebuttal-cache-"));
    resetMock();
    const [d] = await paypal().listDisputes();
    saveInvestigation(d, { model: "gemini:x", recommendation: rec as any, trace: [{ at: "", kind: "tool", tool: "get_dispute", input: { dispute_id: d.dispute_id }, summary: `Dispute ${d.dispute_id}` }] });
    const moved = { ...d, dispute_id: "PP-D-99999" };
    expect(cacheKey(moved)).toBe(cacheKey(d));
    const hit = loadInvestigation(moved)!;
    expect(hit.trace[0].summary).toBe("Dispute PP-D-99999");
    expect(loadInvestigation({ ...d, reason: "UNAUTHORISED" })).toBeNull();
    delete process.env.REBUTTAL_CACHE_DIR;
  });

  it("runAnalysis replays a saved investigation without calling any model", async () => {
    process.env.REBUTTAL_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rebuttal-cache-"));
    delete process.env.GEMINI_API_KEY;
    resetMock();
    await resetCases();
    const [c] = await syncCases();
    saveInvestigation(c.dispute, { model: "gemini:x", recommendation: rec as any, trace: [] });
    const steps: string[] = [];
    const out = await runAnalysis(c.id, (s) => steps.push(s.summary));
    expect(out.status).toBe("READY");
    expect(out.recommendation?.decision).toBe("FIGHT");
    expect(steps[0]).toContain("Saved investigation");
    // A fresh run needs a model, and none is configured here, so the saved one is used.
    const again = await runAnalysis(c.id, undefined, { fresh: true });
    expect(again.notice).toMatch(/saved analysis/);
    await resetCases();
    const [other] = (await syncCases()).filter((x) => x.id !== c.id);
    await expect(runAnalysis(other.id, undefined, { fresh: true })).rejects.toThrow("No AI model configured");
    delete process.env.REBUTTAL_CACHE_DIR;
  });
});
