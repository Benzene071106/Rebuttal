import { connection } from "next/server";
import { json } from "@/lib/auth/http";
import { accountsEnabled, getSeller, publicSeller } from "@/lib/auth/sellers";
import { visitor, withVisitor } from "@/lib/visitor";

// Who is signed in, if anyone, and whether accounts are available on this server.
export const GET = withVisitor(async () => {
  await connection();
  const ref = visitor().seller;
  const seller = ref ? await getSeller(ref.id) : null;
  return json({ accounts: accountsEnabled(), seller: seller ? publicSeller(seller) : null });
});
