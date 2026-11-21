// Waits until the local Postgres container accepts connections (max ~60s).
import pg from "pg";
const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
for (let i = 0; i < 60; i++) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    console.log("database ready");
    process.exit(0);
  } catch {
    await client.end().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.error("database not ready after 60s");
process.exit(1);
