import { runStudioTurn, type StudioTurnRequest } from "@/lib/model/studio-turn";

// AG Studio's agents call this once per model turn (see src/lib/model/studio-turn.ts).
// It spends the server's free-tier Gemini key, so requests are size-capped and each
// browser address gets a modest number of turns per minute.
const MAX_BODY = 600_000;
const PER_MINUTE = 40;
const recent = new Map<string, number[]>();

function allowed(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_MINUTE) return false;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5_000) recent.clear();
  return true;
}

export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: "The AI analyst needs GEMINI_API_KEY on the server." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowed(ip)) return Response.json({ error: "Too many AI requests in a minute. Wait a moment and ask again." }, { status: 429 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "This conversation got too long. Start a new chat." }, { status: 413 });
  let body: StudioTurnRequest;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  if (!Array.isArray(body.input)) return Response.json({ error: "Bad request." }, { status: 400 });
  try {
    const t0 = Date.now();
    const out = await runStudioTurn(body);
    console.log(`studio turn ${out.model} ${Date.now() - t0}ms tools=${body.tools?.length ?? 0} calls=${out.output.filter((o) => o.type === "function_call").map((o) => (o.type === "function_call" ? o.name : "")).join(",")}`);
    return Response.json(out);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("studio turn failed", status, msg.slice(0, 300));
    return Response.json({ error: status === 429 || /rate limit/i.test(msg) ? "The free Gemini quota is busy. Try again in a minute." : "The AI model didn't answer. Try again." }, { status: 502 });
  }
}
