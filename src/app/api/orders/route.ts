import { after, connection } from "next/server";
import { claimUnchecked, listShield, runShield } from "@/lib/shield";
import { runAs, visitor, withVisitor } from "@/lib/visitor";

export const maxDuration = 300;

// Paid orders waiting to ship, with their dispute-risk checks. Orders nobody has
// checked yet are checked in the background, one at a time (free-tier model quota).
export const GET = withVisitor(async () => {
  await connection();
  try {
    const todo = await claimUnchecked();
    if (todo.length) {
      const v = { ...visitor() };
      after(() => runAs(v, async () => {
        for (const id of todo) await runShield(id);
      }));
    }
    return Response.json({ orders: await listShield() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});
