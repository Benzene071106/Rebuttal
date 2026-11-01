import { z } from "zod";
import { BULK_MAX, bulkApprove } from "@/lib/bulk";
import { assertWritable, withVisitor } from "@/lib/visitor";

const Body = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX) });

// Sends the agent's recommended response for each selected dispute, within the guardrails.
export const POST = withVisitor(async (req: Request) => {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Select between 1 and 25 disputes." }, { status: 400 });
  try {
    assertWritable();
    return Response.json(await bulkApprove(body.data.ids));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
});
