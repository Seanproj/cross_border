import { randomUUID } from "node:crypto";
import { Client } from "pg";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

/** Creates an auth user as the superuser (as Supabase Auth would). */
export async function createUser(admin: Client): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [
    id,
    `${id}@test.local`,
  ]);
  return id;
}

export async function createProfile(admin: Client, userId: string, city = "berlin"): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "insert into public.profiles (user_id, move_purpose, city) values ($1, 'employment', $2) returning id",
    [userId, city],
  );
  return rows[0]!.id;
}

/**
 * Runs `fn` inside a transaction that impersonates a request from PostgREST:
 * role `authenticated` with the user's id in the JWT claims (what auth.uid() reads).
 * Always rolled back, so tests do not leak state.
 */
export async function asUser<T>(client: Client, userId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  return impersonate(client, "authenticated", { sub: userId, role: "authenticated" }, fn);
}

export async function asAnon<T>(client: Client, fn: (c: Client) => Promise<T>): Promise<T> {
  return impersonate(client, "anon", { role: "anon" }, fn);
}

async function impersonate<T>(
  client: Client,
  role: "anon" | "authenticated",
  claims: Record<string, string>,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [claims.sub ?? ""]);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

/** Expects the promise to fail with a Postgres error whose message matches. */
export async function expectPgError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`expected a database error matching ${pattern}, but the query succeeded`);
  const message = (error as Error).message;
  if (!pattern.test(message)) throw new Error(`expected error matching ${pattern}, got: ${message}`);
}
