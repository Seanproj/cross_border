/**
 * Database CLI.
 *   pnpm db:migrate   apply supabase/migrations (without Supabase CLI)
 *   pnpm db:seed      validate data/ + eval/ YAML and seed reference tables
 *   pnpm data:check   validate YAML only (no database)
 * Uses DATABASE_URL (defaults to the local test container, see .env.example).
 */
import path from "node:path";
import { Client } from "pg";
import { loadCuratedData, DataValidationError } from "@/server/data/load-curated-data";
import { applyMigrations } from "@/server/db/migrate";
import { seedCuratedData } from "@/server/db/seed-curated-data";
import { validateTemplateSet } from "@/server/domain/template-rules";

const DEFAULT_URL = "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

async function main() {
  const cmd = process.argv[2];
  const root = process.cwd();

  if (cmd === "check") {
    const data = loadCuratedData(root);
    const violations = validateTemplateSet(data.sources, data.templates);
    if (violations.length) throw new DataValidationError(violations.map((v) => `${v.templateKey} [${v.rule}] ${v.message}`));
    const byStatus = Object.groupBy(data.templates, (t) => t.verification_status);
    console.log(
      `ok: ${data.sources.length} sources, ${data.templates.length} templates ` +
        `(${Object.entries(byStatus).map(([k, v]) => `${k} ${v?.length}`).join(", ")}), ${data.evalCases.length} eval cases`,
    );
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL });
  await client.connect();
  try {
    if (cmd === "migrate") {
      const applied = await applyMigrations(client, path.join(root, "supabase/migrations"));
      console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
    } else if (cmd === "seed") {
      const summary = await seedCuratedData(client, loadCuratedData(root));
      console.log("seeded:", summary);
    } else {
      throw new Error(`unknown command: ${cmd ?? "(none)"} — use check | migrate | seed`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
