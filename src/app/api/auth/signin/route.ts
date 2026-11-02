import { clientIp, json, recordFailure, sameOrigin, sessionCookie, tooManyAttempts } from "@/lib/auth/http";
import { accountsEnabled, authenticate, createSession, publicSeller, SignInSchema } from "@/lib/auth/sellers";

export async function POST(req: Request) {
  if (!accountsEnabled()) return json({ error: "Seller accounts aren't enabled on this server." }, 503);
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const parsed = SignInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Enter your email and password." }, 400);
  const keys = [`ip:${clientIp(req)}`, `email:${parsed.data.email}`];
  if (tooManyAttempts(...keys)) return json({ error: "Too many failed sign-ins. Try again in 15 minutes." }, 429);
  try {
    const seller = await authenticate(parsed.data);
    if (!seller) {
      recordFailure(...keys);
      return json({ error: "That email and password don't match." }, 401);
    }
    const token = await createSession(seller.id);
    return json({ seller: publicSeller(seller) }, 200, { "Set-Cookie": sessionCookie(token) });
  } catch (e) {
    console.error("signin failed:", e);
    return json({ error: "Could not sign in. Try again." }, 500);
  }
}
