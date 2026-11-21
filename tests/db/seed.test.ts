import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCuratedData } from "@/server/data/load-curated-data";
import { seedCuratedData } from "@/server/db/seed-curated-data";
import { connect } from "./helpers";

let admin: Client;
beforeAll(async () => {
  admin = await connect();
});
afterAll(async () => {
  await admin.end();
});

const count = async (table: string) =>
  Number((await admin.query(`select count(*)::int as n from public.${table}`)).rows[0].n);

describe("seeding curated data", () => {
  it("is idempotent", async () => {
    const data = loadCuratedData();
    const before = {
      templates: await count("task_templates"),
      sources: await count("template_sources"),
      prerequisites: await count("template_prerequisites"),
    };
    const summary = await seedCuratedData(admin, data);
    expect(summary.templates).toBe(data.templates.length);
    expect({
      templates: await count("task_templates"),
      sources: await count("template_sources"),
      prerequisites: await count("template_prerequisites"),
    }).toEqual(before);
  });

  it("rolls back entirely when the data breaks a rule", async () => {
    const data = loadCuratedData();
    const broken = structuredClone(data);
    broken.templates[0]!.prerequisites.push({ template_key: "does.not_exist", kind: "hard" });
    const titleBefore = (await admin.query("select title from public.task_templates where template_key = $1", [data.templates[0]!.template_key])).rows[0].title;
    await expect(seedCuratedData(admin, broken)).rejects.toThrow(/unknown prerequisite/);
    const titleAfter = (await admin.query("select title from public.task_templates where template_key = $1", [data.templates[0]!.template_key])).rows[0].title;
    expect(titleAfter).toBe(titleBefore);
  });

  it("keeps every excerpt linked to an official source", async () => {
    const { rows } = await admin.query(
      `select count(*)::int as n from public.template_sources ts
         join public.source_documents sd on sd.id = ts.source_document_id
        where sd.trust_level <> 'official'`,
    );
    expect(rows[0].n).toBe(0);
  });
});
