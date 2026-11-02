import { analyzeDispute } from "./agent";
import { getCase, updateCase } from "./cases";
import { scriptedModel } from "./dev/scripted-model";
import { loadInvestigation, saveInvestigation } from "./investigation-cache";
import { plainError } from "./errors";
import { withCaseLock } from "./locks";
import { claudeModel } from "./model";
import { RateLimitError } from "./model/gemini";
import { paypal } from "./paypal";
import type { CaseRecord, TraceStep } from "./types";
import { READ_ONLY_MESSAGE } from "./visitor";

const REPLAY_STEP_MS = 450;

export async function runAnalysis(caseId: string, onStep?: (s: TraceStep) => void, opts: { fresh?: boolean; savedOnly?: boolean } = {}): Promise<CaseRecord> {
  const c = getCase(caseId);
  if (!c) throw new Error(`Unknown case ${caseId}`);
  if (c.submitted) throw new Error("This dispute already has a response.");
  if (opts.savedOnly && (opts.fresh || !loadInvestigation(c.dispute))) throw new Error(READ_ONLY_MESSAGE);
  // Shares the per-dispute lock with approve(), so a response can't be sent mid-investigation.
  return withCaseLock(caseId, "Analysis", () => investigate(caseId, onStep, opts));
}

async function investigate(caseId: string, onStep: ((s: TraceStep) => void) | undefined, opts: { fresh?: boolean }): Promise<CaseRecord> {
  try {
    if (getCase(caseId)?.submitted) throw new Error("This dispute already has a response.");
    const dispute = await paypal().getDispute(caseId);
    updateCase(caseId, { dispute, status: "ANALYZING", trace: [], recommendation: undefined, error: undefined, notice: undefined });
    const trace: TraceStep[] = [];
    const emit = (s: TraceStep) => {
      trace.push(s);
      updateCase(caseId, { trace: [...trace] });
      onStep?.(s);
    };

    const saved = opts.fresh ? null : loadInvestigation(dispute);
    if (saved) return await replay(caseId, saved, emit);

    const scripted = process.env.REBUTTAL_SCRIPTED_MODEL === "1" && process.env.NODE_ENV !== "production";
    try {
      const { recommendation, model } = await analyzeDispute(dispute, {
        model: scripted ? claudeModel({ client: scriptedModel() as never }) : undefined,
        onStep: emit,
      });
      if (!scripted) saveInvestigation(dispute, { model, recommendation, trace });
      return updateCase(caseId, { status: "READY", recommendation, trace });
    } catch (e) {
      // Every Gemini model failed (quota, overload, timeout, a bad answer): fall back to
      // the last saved investigation for these facts instead of leaving the seller with
      // an error.
      const fallback = loadInvestigation(dispute);
      if (fallback) {
        console.warn("Investigation failed, using the saved analysis:", e instanceof Error ? e.message : e);
        const why = `${e instanceof RateLimitError ? "The AI model is rate-limited" : "The AI model is busy"} right now, so this is the saved analysis from ${fallback.saved_at.slice(0, 10)}. Re-run later for a fresh one.`;
        await replay(caseId, fallback, emit, why);
        return updateCase(caseId, { notice: why });
      }
      throw e;
    }
  } catch (e) {
    const error = plainError(e);
    // Never mark an answered dispute as failed.
    if (!getCase(caseId)?.submitted) updateCase(caseId, { status: "ERROR", error });
    throw e;
  }
}

// Plays a saved investigation back at a readable pace, so the live trace still shows
// each step the agent took.
async function replay(caseId: string, saved: NonNullable<ReturnType<typeof loadInvestigation>>, emit: (s: TraceStep) => void, why?: string) {
  const date = saved.saved_at.slice(0, 10);
  emit({ at: new Date().toISOString(), kind: "note", summary: why ?? `Saved investigation from ${date} (${saved.model}). Re-run for a fresh one.` });
  for (const s of saved.trace) {
    await new Promise((r) => setTimeout(r, REPLAY_STEP_MS));
    emit({ ...s, at: new Date().toISOString() });
  }
  return updateCase(caseId, { status: "READY", recommendation: saved.recommendation });
}
