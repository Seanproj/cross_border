/**
 * Minimal migration runner for environments without the Supabase CLI
 * (CI service container, cloud sandboxes). Applies supabase/migrations/*.sql
 * in filename order and records them in the same table the Supabase CLI uses,
 * so `supabase db push` later treats them as applied.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";

export async function applyMigrations(client: Client, dir: string): Promise<string[]> {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    );`);
  const { rows } = await client.query<{ version: string }>(
    "select version from supabase_migrations.schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.version));
  const newlyApplied: string[] = [];

  for (const file of readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    if (!version || applied.has(version)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
        [version, [sql], rest.join("_")],
      );
      await client.query("commit");
      newlyApplied.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return newlyApplied;
}
