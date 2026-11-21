import path from "node:path";
import { loadCuratedData } from "@/server/data/load-curated-data";
import { applyMigrations } from "@/server/db/migrate";
import { seedCuratedData } from "@/server/db/seed-curated-data";
import { connect, DATABASE_URL } from "./helpers";

/** Migrates and seeds the test database once before the DB test files run. */
export default async function setup() {
  const client = await connect().catch((err: Error) => {
    throw new Error(`Cannot reach test database at ${DATABASE_URL} (run \`pnpm db:up\`): ${err.message}`);
  });
  try {
    await applyMigrations(client, path.resolve(__dirname, "../../supabase/migrations"));
    await seedCuratedData(client, loadCuratedData(path.resolve(__dirname, "../..")));
  } finally {
    await client.end();
  }
}
