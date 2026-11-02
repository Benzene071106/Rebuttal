// Password hashing and encryption of the PayPal credentials sellers connect.
//
// Passwords: scrypt with a random salt, compared in constant time.
// PayPal secrets: AES-256-GCM with REBUTTAL_SECRET_KEY (32 random bytes, base64), so a
// leaked database dump alone doesn't hand over sellers' PayPal accounts.

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// A hash to compare against when the email is unknown, so a failed sign-in takes the
// same time whether or not the account exists.
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(crypto.randomBytes(16).toString("hex"));
  return decoy;
}

// 32 random bytes in base64 (openssl rand -base64 32) are used as they are; any other
// value of at least 32 characters (such as one a host generates) is hashed to 32 bytes.
function secretKey(): Buffer {
  const raw = process.env.REBUTTAL_SECRET_KEY?.trim();
  if (!raw) throw new Error("REBUTTAL_SECRET_KEY is not set. Generate one with: openssl rand -base64 32");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(raw)) return decoded;
  if (raw.length < 32) throw new Error("REBUTTAL_SECRET_KEY is too short. Generate one with: openssl rand -base64 32");
  return crypto.createHash("sha256").update(raw).digest();
}

export function secretKeyConfigured(): boolean {
  try {
    secretKey();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable encrypted value.");
  const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
