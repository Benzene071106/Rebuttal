import { connection } from "next/server";
import { getRules, RulesSchema, setRules } from "@/lib/rules";
import { assertWritable, withVisitor } from "@/lib/visitor";

export const GET = withVisitor(async () => {
  await connection(); // rules are per visitor in the simulator
  return Response.json(getRules());
});

// Saves this visitor's autopilot rules (or the shared live sandbox rules, where writable).
export const POST = withVisitor(async (req: Request) => {
  const body = RulesSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid rules." }, { status: 400 });
  try {
    assertWritable();
    return Response.json(setRules(body.data));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
});
