/**
 * Seeds reference data (sources, templates, eval cases) in one transaction.
 * Idempotent: upserts by stable keys and replaces each template's
 * prerequisites/sources, so re-running after editing YAML converges.
 * Must run with a role that bypasses RLS (postgres / service_role).
 */
import type { Client } from "pg";
import type { CuratedData } from "@/server/data/load-curated-data";
import { DataValidationError } from "@/server/data/load-curated-data";
import { validateTemplateSet } from "@/server/domain/template-rules";

export type SeedSummary = { sources: number; templates: number; prerequisites: number; templateSources: number; evalCases: number };

export async function seedCuratedData(client: Client, data: CuratedData): Promise<SeedSummary> {
  const violations = validateTemplateSet(data.sources, data.templates);
  if (violations.length) {
    throw new DataValidationError(violations.map((v) => `${v.templateKey ?? "-"} [${v.rule}] ${v.message}`));
  }

  const summary: SeedSummary = { sources: 0, templates: 0, prerequisites: 0, templateSources: 0, evalCases: 0 };
  await client.query("begin");
  try {
    const sourceIds = new Map<string, string>();
    for (const s of data.sources) {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.source_documents
           (source_key, title, authority, url, language, country_code, region_scope, trust_level,
            published_or_updated_at, checked_at, checked_by, content_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (source_key) do update set
           title = excluded.title, authority = excluded.authority, url = excluded.url,
           language = excluded.language, country_code = excluded.country_code,
           region_scope = excluded.region_scope, trust_level = excluded.trust_level,
           published_or_updated_at = excluded.published_or_updated_at,
           checked_at = excluded.checked_at, checked_by = excluded.checked_by,
           content_hash = excluded.content_hash
         returning id`,
        [s.source_key, s.title, s.authority, s.url, s.language, s.country_code, s.region_scope,
          s.trust_level, s.published_or_updated_at, s.checked_at, s.checked_by, s.content_hash ?? null],
      );
      sourceIds.set(s.source_key, rows[0]!.id);
      summary.sources++;
    }

    const templateIds = new Map<string, string>();
    for (const t of data.templates) {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.task_templates
           (template_key, version, category, title, description, region_scope, applicability,
            required_documents, deadline_rule, estimated_duration, verification_status,
            last_verified_at, review_notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (template_key) do update set
           version = excluded.version, category = excluded.category, title = excluded.title,
           description = excluded.description, region_scope = excluded.region_scope,
           applicability = excluded.applicability, required_documents = excluded.required_documents,
           deadline_rule = excluded.deadline_rule, estimated_duration = excluded.estimated_duration,
           verification_status = excluded.verification_status,
           last_verified_at = excluded.last_verified_at, review_notes = excluded.review_notes
         returning id`,
        [t.template_key, t.version, t.category, t.title, t.description, t.region_scope,
          JSON.stringify(t.applicability), JSON.stringify(t.required_documents),
          t.deadline_rule ? JSON.stringify(t.deadline_rule) : null, t.estimated_duration,
          t.verification_status, t.last_verified_at, t.review_notes],
      );
      templateIds.set(t.template_key, rows[0]!.id);
      summary.templates++;
    }

    const ids = [...templateIds.values()];
    await client.query("delete from public.template_prerequisites where template_id = any($1::uuid[])", [ids]);
    await client.query("delete from public.template_sources where template_id = any($1::uuid[])", [ids]);

    for (const t of data.templates) {
      const tid = templateIds.get(t.template_key)!;
      for (const p of t.prerequisites) {
        await client.query(
          "insert into public.template_prerequisites (template_id, prerequisite_template_id, kind) values ($1,$2,$3)",
          [tid, templateIds.get(p.template_key)!, p.kind],
        );
        summary.prerequisites++;
      }
      for (const s of t.sources) {
        await client.query(
          "insert into public.template_sources (template_id, source_document_id, supports, excerpt) values ($1,$2,$3,$4)",
          [tid, sourceIds.get(s.source_key)!, s.supports, s.excerpt],
        );
        summary.templateSources++;
      }
    }

    for (const c of data.evalCases) {
      await client.query(
        `insert into public.evaluation_cases
           (case_key, feature, scenario, severity, tags, input_json, expected_json, forbidden, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (case_key) do update set
           feature = excluded.feature, scenario = excluded.scenario, severity = excluded.severity,
           tags = excluded.tags, input_json = excluded.input_json, expected_json = excluded.expected_json,
           forbidden = excluded.forbidden, notes = excluded.notes`,
        [c.case_key, c.feature, c.scenario ?? null, c.severity, c.tags, JSON.stringify(c.input),
          JSON.stringify(c.expected), JSON.stringify(c.forbidden), c.notes ?? null],
      );
      summary.evalCases++;
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
  return summary;
}
