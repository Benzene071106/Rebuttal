// Seller accounts, sign-in sessions and each seller's connected PayPal app.
//
// A seller connects PayPal by pasting the Client ID and Secret of a REST app from their
// own PayPal developer dashboard (sandbox or live). That works today, for any PayPal
// business account, without Rebuttal joining PayPal's partner program. The secret is
// stored encrypted (see secrets.ts) and only decrypted on the server to call PayPal.

import crypto from "node:crypto";
import { z } from "zod";
import { databaseConfigured } from "../store";
import { query } from "../store/db";
import { decoyHash, decrypt, encrypt, hashPassword, secretKeyConfigured, sha256, verifyPassword } from "./secrets";

export type PayPalEnv = "sandbox" | "live";

export type PayPalConnection = {
  env: PayPalEnv;
  client_id: string;
  secret_enc: string;
  webhook_id: string | null;
  merchant_email?: string | null;
  connected_at: string;
};

export type Seller = {
  id: string;
  email: string;
  shop_name: string;
  paypal: PayPalConnection | null;
  created_at: string;
};

// Accounts need somewhere durable to live and a key to seal PayPal secrets with.
export function accountsEnabled(): boolean {
  return databaseConfigured() && secretKeyConfigured();
}

export const SignUpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  shop_name: z.string().trim().max(120).default(""),
});

export const SignInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

type Row = { id: string; email: string; password_hash: string; shop_name: string; paypal: PayPalConnection | null; created_at: Date };
const toSeller = (r: Row): Seller => ({ id: r.id, email: r.email, shop_name: r.shop_name, paypal: r.paypal, created_at: new Date(r.created_at).toISOString() });

export class AccountError extends Error {}

export async function createSeller(input: z.infer<typeof SignUpSchema>): Promise<Seller> {
  const id = crypto.randomUUID();
  const hash = await hashPassword(input.password);
  const rows = await query<Row>(
    "insert into sellers (id, email, password_hash, shop_name) values ($1, $2, $3, $4) on conflict (email) do nothing returning *",
    [id, input.email, hash, input.shop_name],
  );
  if (!rows[0]) throw new AccountError("An account with that email already exists. Sign in instead.");
  return toSeller(rows[0]);
}

export async function authenticate(input: z.infer<typeof SignInSchema>): Promise<Seller | null> {
  const row = (await query<Row>("select * from sellers where email = $1", [input.email]))[0];
  const ok = await verifyPassword(input.password, row?.password_hash ?? (await decoyHash()));
  return row && ok ? toSeller(row) : null;
}

export async function getSeller(id: string): Promise<Seller | null> {
  const row = (await query<Row>("select * from sellers where id = $1", [id]))[0];
  return row ? toSeller(row) : null;
}

// Sessions: the browser holds a random token, the database only its hash.
export const SESSION_COOKIE = "rebuttal_session";
export const SESSION_DAYS = 30;

export async function createSession(sellerId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await query("insert into sessions (token_hash, seller_id, expires_at) values ($1, $2, now() + make_interval(days => $3))", [sha256(token), sellerId, SESSION_DAYS]);
  // Old sessions are cleaned up as new ones are made.
  await query("delete from sessions where expires_at < now()");
  return token;
}

export async function sellerForSession(token: string | undefined): Promise<Seller | null> {
  if (!token || !accountsEnabled() || token.length > 100) return null;
  const rows = await query<Row>(
    "select s.* from sessions x join sellers s on s.id = x.seller_id where x.token_hash = $1 and x.expires_at > now()",
    [sha256(token)],
  );
  return rows[0] ? toSeller(rows[0]) : null;
}

export async function endSession(token: string | undefined) {
  if (token) await query("delete from sessions where token_hash = $1", [sha256(token)]);
}

export async function savePayPal(sellerId: string, c: { env: PayPalEnv; client_id: string; secret: string; webhook_id: string | null; merchant_email?: string | null }): Promise<Seller> {
  const conn: PayPalConnection = {
    env: c.env,
    client_id: c.client_id,
    secret_enc: encrypt(c.secret),
    webhook_id: c.webhook_id,
    merchant_email: c.merchant_email ?? null,
    connected_at: new Date().toISOString(),
  };
  const rows = await query<Row>("update sellers set paypal = $2 where id = $1 returning *", [sellerId, JSON.stringify(conn)]);
  return toSeller(rows[0]);
}

export async function clearPayPal(sellerId: string) {
  await query("update sellers set paypal = null where id = $1", [sellerId]);
}

export function paypalSecret(c: PayPalConnection): string {
  return decrypt(c.secret_enc);
}

// What the browser may see about a seller: never the secret.
export function publicSeller(s: Seller) {
  return {
    id: s.id,
    email: s.email,
    shop_name: s.shop_name,
    paypal: s.paypal ? { env: s.paypal.env, client_id: s.paypal.client_id, webhooks: Boolean(s.paypal.webhook_id), connected_at: s.paypal.connected_at } : null,
  };
}
