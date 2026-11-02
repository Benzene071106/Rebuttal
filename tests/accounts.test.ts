// Seller accounts: password and secret handling always run; sign-up, sessions and
// per-seller data run against TEST_DATABASE_URL when it is set.

import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate, createSeller, createSession, endSession, getSeller, publicSeller, savePayPal, sellerForSession, SignUpSchema } from "../src/lib/auth/sellers";
import { decrypt, encrypt, hashPassword, verifyPassword } from "../src/lib/auth/secrets";
import { getCase, listCases, upsertFromDispute } from "../src/lib/cases";
import { getRules, setRules, DEFAULT_RULES } from "../src/lib/rules";
import { closeDb } from "../src/lib/store/db";
import type { Dispute } from "../src/lib/types";
import { runAs, tenant, type Visitor } from "../src/lib/visitor";

const pgUrl = process.env.TEST_DATABASE_URL;

beforeAll(() => {
  process.env.REBUTTAL_SECRET_KEY = crypto.randomBytes(32).toString("base64");
  if (pgUrl) process.env.DATABASE_URL = pgUrl;
});
afterAll(async () => {
  if (pgUrl) {
    await closeDb();
    delete process.env.DATABASE_URL;
  }
});

describe("secrets", () => {
  it("hashes and checks passwords", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("encrypts PayPal secrets so they can't be read or altered", () => {
    const sealed = encrypt("EPxx-secret");
    expect(sealed).not.toContain("EPxx");
    expect(decrypt(sealed)).toBe("EPxx-secret");
    const [v, iv, tag, body] = sealed.split(".");
    const flipped = Buffer.from(body, "base64");
    flipped[0] ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });
});

const dispute = (id: string): Dispute =>
  ({
    dispute_id: id,
    create_time: "2026-11-01T00:00:00Z",
    status: "WAITING_FOR_SELLER_RESPONSE",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    dispute_amount: { currency_code: "USD", value: "40.00" },
    disputed_transactions: [],
  }) as unknown as Dispute;

describe.skipIf(!pgUrl)("accounts on Postgres", () => {
  const email = () => `seller-${crypto.randomUUID()}@example.com`;

  it("signs up, signs in and keeps sessions", async () => {
    const input = SignUpSchema.parse({ email: email(), password: "long enough pw", shop_name: "Jade & Kiln" });
    const s = await createSeller(input);
    await expect(createSeller(input)).rejects.toThrow(/already exists/);
    expect(await authenticate({ email: input.email, password: "nope" })).toBeNull();
    expect((await authenticate({ email: input.email, password: "long enough pw" }))?.id).toBe(s.id);
    const token = await createSession(s.id);
    expect((await sellerForSession(token))?.id).toBe(s.id);
    await endSession(token);
    expect(await sellerForSession(token)).toBeNull();
  });

  it("never shows the PayPal secret", async () => {
    const s = await createSeller(SignUpSchema.parse({ email: email(), password: "long enough pw" }));
    const saved = await savePayPal(s.id, { env: "sandbox", client_id: "AbCdEfGhIj123", secret: "EPsecret-value-123", webhook_id: "WH-1" });
    expect(JSON.stringify(publicSeller(saved))).not.toContain("EPsecret");
    expect(JSON.stringify(await getSeller(s.id))).not.toContain("EPsecret");
  });

  it("keeps each seller's cases and rules to themselves", async () => {
    const a = await createSeller(SignUpSchema.parse({ email: email(), password: "long enough pw" }));
    const b = await createSeller(SignUpSchema.parse({ email: email(), password: "long enough pw" }));
    const as = (s: typeof a): Visitor => ({ id: crypto.randomUUID(), mode: "sandbox", seller: { id: s.id, email: s.email, paypal: null } });
    const va = as(a);
    const vb = as(b);
    expect(tenant(va)).toBe(`seller:${a.id}`);

    await runAs(va, async () => {
      await upsertFromDispute(dispute("PP-D-1"));
      await setRules({ ...DEFAULT_RULES, auto_refund_max: 12 });
    });
    await runAs(vb, async () => {
      expect(await getCase("PP-D-1")).toBeUndefined();
      expect(await listCases()).toEqual([]);
      expect((await getRules()).auto_refund_max).toBe(DEFAULT_RULES.auto_refund_max);
    });
    // Another server instance (a fresh visitor for the same seller) sees the same data.
    await runAs(as(a), async () => {
      expect((await getCase("PP-D-1"))?.status).toBe("NEW");
      expect((await getRules()).auto_refund_max).toBe(12);
    });
  });
});
