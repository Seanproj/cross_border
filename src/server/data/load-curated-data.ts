/**
 * Loads and schema-validates the curated YAML files under data/ and eval/.
 * Throws with a readable list of issues if any file is invalid.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  evalCaseSchema,
  sourceSchema,
  templateSchema,
  type EvalCase,
  type Source,
  type Template,
} from "@/lib/validation/data-schemas";

export class DataValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Curated data is invalid:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
  }
}

function yamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...yamlFiles(full));
    else if (/\.ya?ml$/.test(name)) out.push(full);
  }
  return out;
}

function parseList<T>(files: string[], schema: z.ZodType<T>, root: string): T[] {
  const items: T[] = [];
  const issues: string[] = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    const doc: unknown = parse(readFileSync(file, "utf8"));
    if (!Array.isArray(doc)) {
      issues.push(`${rel}: top level must be a list`);
      continue;
    }
    doc.forEach((raw, i) => {
      const result = schema.safeParse(raw);
      if (result.success) items.push(result.data);
      else {
        const label = (raw as { template_key?: string; source_key?: string; case_key?: string }) ?? {};
        const id = label.template_key ?? label.source_key ?? label.case_key ?? `#${i}`;
        for (const issue of result.error.issues) {
          issues.push(`${rel} ${id} ${issue.path.join(".")}: ${issue.message}`);
        }
      }
    });
  }
  if (issues.length) throw new DataValidationError(issues);
  return items;
}

export type CuratedData = { sources: Source[]; templates: Template[]; evalCases: EvalCase[] };

export function loadCuratedData(root: string = process.cwd()): CuratedData {
  return {
    sources: parseList(yamlFiles(path.join(root, "data/sources")), sourceSchema, root),
    templates: parseList(yamlFiles(path.join(root, "data/templates")), templateSchema, root),
    evalCases: parseList(yamlFiles(path.join(root, "eval/cases")), evalCaseSchema, root),
  };
}
