/**
 * Cross-file integrity rules for templates and sources (docs/DATA_SPEC.md §2).
 * Pure functions: no I/O. The database enforces the most critical rules again
 * (supabase/migrations/*_core_schema.sql) as defence in depth.
 */
import type { Source, Template } from "@/lib/validation/data-schemas";

export type RuleViolation = { templateKey: string | null; rule: string; message: string };

/** Returns template keys forming a cycle (empty if the prerequisite graph is a DAG). */
export function findPrerequisiteCycle(templates: Template[]): string[] {
  const byKey = new Map(templates.map((t) => [t.template_key, t]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (key: string): string[] => {
    state.set(key, "visiting");
    stack.push(key);
    for (const p of byKey.get(key)?.prerequisites ?? []) {
      if (!byKey.has(p.template_key)) continue;
      const s = state.get(p.template_key);
      if (s === "visiting") return [...stack.slice(stack.indexOf(p.template_key)), p.template_key];
      if (s === undefined) {
        const cycle = visit(p.template_key);
        if (cycle.length) return cycle;
      }
    }
    stack.pop();
    state.set(key, "done");
    return [];
  };

  for (const key of byKey.keys()) {
    if (!state.has(key)) {
      const cycle = visit(key);
      if (cycle.length) return cycle;
    }
  }
  return [];
}

export function validateTemplateSet(sources: Source[], templates: Template[]): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const add = (templateKey: string | null, rule: string, message: string) =>
    violations.push({ templateKey, rule, message });

  const sourceByKey = new Map<string, Source>();
  for (const s of sources) {
    if (sourceByKey.has(s.source_key)) add(null, "unique_source_key", `duplicate source_key ${s.source_key}`);
    sourceByKey.set(s.source_key, s);
  }
  const urls = new Set<string>();
  for (const s of sources) {
    if (urls.has(s.url)) add(null, "unique_source_url", `duplicate url ${s.url}`);
    urls.add(s.url);
  }

  const templateKeys = new Set<string>();
  for (const t of templates) {
    if (templateKeys.has(t.template_key)) add(t.template_key, "unique_template_key", "duplicate template_key");
    templateKeys.add(t.template_key);
  }

  for (const t of templates) {
    const k = t.template_key;
    const supports = new Map<string, Set<string>>();
    for (const s of t.sources) {
      if (!sourceByKey.has(s.source_key)) {
        add(k, "known_source", `unknown source_key ${s.source_key}`);
        continue;
      }
      const set = supports.get(s.source_key) ?? new Set<string>();
      s.supports.forEach((x) => set.add(x));
      supports.set(s.source_key, set);
    }
    const hasExistence = [...supports.values()].some((set) => set.has("existence"));

    if (t.verification_status !== "draft" && !hasExistence) {
      add(k, "existence_source", `${t.verification_status} template needs a source with supports=existence`);
    }
    if (t.verification_status === "verified") {
      if (!t.last_verified_at) add(k, "verified_date", "verified template needs last_verified_at");
      for (const key of supports.keys()) {
        if (sourceByKey.get(key)?.checked_by !== "human") {
          add(k, "human_reviewed_source", `verified template uses source ${key} not reviewed by a human`);
        }
      }
    }
    if (t.deadline_rule && !supports.get(t.deadline_rule.source_key)?.has("deadline")) {
      add(k, "deadline_source", `deadline_rule source ${t.deadline_rule.source_key} lacks supports=deadline`);
    }
    for (const doc of t.required_documents) {
      if (doc.source_key && !supports.get(doc.source_key)?.has("documents")) {
        add(k, "document_source", `document "${doc.name}" cites ${doc.source_key} without supports=documents`);
      }
    }
    for (const p of t.prerequisites) {
      if (!templateKeys.has(p.template_key)) add(k, "known_prerequisite", `unknown prerequisite ${p.template_key}`);
      if (p.template_key === k) add(k, "self_prerequisite", "template lists itself as prerequisite");
    }
  }

  const cycle = findPrerequisiteCycle(templates);
  if (cycle.length) add(cycle[0] ?? null, "acyclic_prerequisites", `cycle: ${cycle.join(" -> ")}`);

  return violations;
}
