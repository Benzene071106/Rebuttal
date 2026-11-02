import { clientIp, json, recordFailure, sameOrigin, sessionCookie, tooManyAttempts } from "@/lib/auth/http";
import { AccountError, accountsEnabled, createSeller, createSession, publicSeller, SignUpSchema } from "@/lib/auth/sellers";

// Creates a seller account and signs it in.
export async function POST(req: Request) {
  if (!accountsEnabled()) return json({ error: "Seller accounts aren't enabled on this server (it needs DATABASE_URL and REBUTTAL_SECRET_KEY)." }, 503);
  if (!sameOrigin(req)) return json({ error: "Cross-site request refused." }, 403);
  const ip = `ip:${clientIp(req)}`;
  if (tooManyAttempts(ip)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
  const parsed = SignUpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, 400);
  try {
    const seller = await createSeller(parsed.data);
    const token = await createSession(seller.id);
    return json({ seller: publicSeller(seller) }, 201, { "Set-Cookie": sessionCookie(token) });
  } catch (e) {
    if (e instanceof AccountError) {
      recordFailure(ip); // slows down probing which emails have accounts
      return json({ error: e.message }, 409);
    }
    console.error("signup failed:", e);
    return json({ error: "Could not create the account. Try again." }, 500);
  }
}
