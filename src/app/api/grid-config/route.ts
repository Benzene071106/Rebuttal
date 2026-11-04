import { connection } from "next/server";

// Tells the browser whether to load AG Grid Enterprise. Only when the server has an
// AG_GRID_LICENSE_KEY; otherwise the app stays on AG Grid Community (no watermark).
// AG_STUDIO_LICENSE_KEY licenses AG Studio on the "Ask your disputes" page.
// AG license keys are meant to ship to the browser, like any client license.
export async function GET() {
  await connection();
  const key = process.env.AG_GRID_LICENSE_KEY?.trim();
  const studioKey = process.env.AG_STUDIO_LICENSE_KEY?.trim();
  return Response.json({ ...(key ? { enterprise: true, key } : { enterprise: false }), ...(studioKey ? { studioKey } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
