// Postgres connection and schema. Migrations run once per process, on first use, and
// are recorded in schema_migrations so each runs exactly once per database.

import { Pool, type PoolClient } from "pg";

const MIGRATIONS: string[] = [
  // 1: tenant-scoped records and seller accounts
  `
  create table if not exists cases (
    tenant text not null,
    id text not null,
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (tenant, id)
  );
  create table if not exists rules (
    tenant text primary key,
    data jsonb not null,
    updated_at timestamptz not null default now()
  );
  create table if not exists incidents (
    tenant text not null,
    id text not null,
    at timestamptz not null,
    data jsonb not null,
    primary key (tenant, id)
  );
  create index if not exists incidents_tenant_at on incidents (tenant, at desc);
  create table if not exists webhook_events (
    tenant text not null,
    event_id text not null,
    received_at timestamptz not null default now(),
    primary key (tenant, event_id)
  );
  create table if not exists sellers (
    id uuid primary key,
    email text not null unique,
    password_hash text not null,
    shop_name text not null default '',
    paypal jsonb,
    created_at timestamptz not null default now()
  );
  create table if not exists sessions (
    token_hash text primary key,
    seller_id uuid not null references sellers(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  );
  create index if not exists sessions_seller on sessions (seller_id);
  `,
];

const g = globalThis as unknown as { __rebuttalPool?: Pool; __rebuttalMigrated?: Promise<void> };

function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  g.__rebuttalPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // Render's internal URLs need no TLS; external ones do. DATABASE_SSL=1 forces it.
    ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: false } : undefined,
  });
  return g.__rebuttalPool;
}

async function migrate(): Promise<void> {
  const c = await pool().connect();
  try {
    // One server at a time runs migrations.
    await c.query("select pg_advisory_lock(424242)");
    await c.query("create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())");
    const done = new Set((await c.query<{ version: number }>("select version from schema_migrations")).rows.map((r) => r.version));
    for (const [i, sql] of MIGRATIONS.entries()) {
      const version = i + 1;
      if (done.has(version)) continue;
      await c.query("begin");
      try {
        await c.query(sql);
        await c.query("insert into schema_migrations (version) values ($1)", [version]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    }
  } finally {
    await c.query("select pg_advisory_unlock(424242)").catch(() => {});
    c.release();
  }
}

function ready(): Promise<void> {
  g.__rebuttalMigrated ??= migrate().catch((e) => {
    g.__rebuttalMigrated = undefined; // try again on the next request
    throw e;
  });
  return g.__rebuttalMigrated;
}

export async function query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
  await ready();
  return (await pool().query<R>(sql, params)).rows;
}

// Runs `fn` in a transaction on one connection.
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const c = await pool().connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function dbHealthy(): Promise<boolean> {
  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
}

// For tests: drop the pool so the next query connects to the current DATABASE_URL.
export async function closeDb() {
  await g.__rebuttalPool?.end().catch(() => {});
  g.__rebuttalPool = undefined;
  g.__rebuttalMigrated = undefined;
}
