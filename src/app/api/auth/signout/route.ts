import { clearSessionCookie, json, sameOrigin } from "@/lib/auth/http";
import { endSession, SESSION_COOKIE } from "@/lib/auth/sellers";
import { readCookie } from "@/lib/visitor";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  await endSession(readCookie(req, SESSION_COOKIE)).catch((e) => console.error("signout failed:", e));
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}
