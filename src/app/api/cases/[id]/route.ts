import { connection } from "next/server";
import { getCase } from "@/lib/cases";
import { withVisitor } from "@/lib/visitor";

export const GET = withVisitor(async (_req: Request, ctx: RouteContext<"/api/cases/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const c = await getCase(id);
  return c ? Response.json(c) : Response.json({ error: "Not found" }, { status: 404 });
});
