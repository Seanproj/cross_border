/**
 * Zod schemas for the curated data files (docs/DATA_SPEC.md).
 * Shared by the seed script, unit tests and (later) the evaluation runner.
 */
import { z } from "zod";

export const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
export const REGION_SCOPE_PATTERN = /^(federal|national_kr|state:DE-[A-Z]{2}|city:[a-z_]+)$/;

export const CATEGORIES = [
  "housing_registration",
  "residence_admin",
  "finance_tax",
  "insurance",
  "telecom",
  "driving_vehicle",
] as const;

export const SUPPORT_KINDS = ["existence", "deadline", "documents", "fee", "procedure"] as const;
export const VERIFICATION_STATUSES = ["draft", "needs_review", "verified"] as const;

/** Profile fields the applicability DSL may reference (FR-01). */
export const PROFILE_FIELDS = [
  "move_purpose",
  "household_type",
  "housing_status",
  "city",
  "state_code",
  "target_move_date",
  "arrival_date",
  "move_in_date",
] as const;

/** YAML parses unquoted dates as Date objects; normalise to YYYY-MM-DD strings. */
const isoDate = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
);

export const sourceSchema = z
  .object({
    source_key: z.string().regex(KEY_PATTERN),
    title: z.string().min(1),
    authority: z.string().min(1),
    url: z.string().url().startsWith("https://"),
    language: z.enum(["de", "en", "ko"]),
    country_code: z.enum(["DE", "KR"]),
    region_scope: z.string().regex(REGION_SCOPE_PATTERN),
    trust_level: z.enum(["official", "secondary"]),
    published_or_updated_at: isoDate.nullable(),
    checked_at: isoDate,
    checked_by: z.enum(["ai_fetch", "human"]),
    content_hash: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .nullable()
      .optional(),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;

const conditionSchema = z
  .object({
    field: z.enum(PROFILE_FIELDS),
    op: z.enum(["eq", "neq", "in", "not_in", "is_set"]),
    value: z.unknown().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const needsArray = c.op === "in" || c.op === "not_in";
    if (needsArray && !Array.isArray(c.value)) {
      ctx.addIssue({ code: "custom", message: `op ${c.op} requires an array value` });
    }
    if ((c.op === "eq" || c.op === "neq") && (c.value === undefined || Array.isArray(c.value))) {
      ctx.addIssue({ code: "custom", message: `op ${c.op} requires a scalar value` });
    }
  });

export type Applicability = {
  review_required?: boolean;
  all?: Array<z.infer<typeof conditionSchema> | Applicability>;
  any?: Array<z.infer<typeof conditionSchema> | Applicability>;
};

export const applicabilitySchema: z.ZodType<Applicability> = z.lazy(() =>
  z
    .object({
      review_required: z.boolean().optional(),
      all: z.array(z.union([conditionSchema, applicabilitySchema])).optional(),
      any: z.array(z.union([conditionSchema, applicabilitySchema])).optional(),
    })
    .strict()
    .refine((a) => a.all !== undefined || a.any !== undefined, "applicability needs `all` or `any`"),
);

export const templateSchema = z
  .object({
    template_key: z.string().regex(KEY_PATTERN),
    version: z.number().int().min(1),
    category: z.enum(CATEGORIES),
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    region_scope: z.string().regex(REGION_SCOPE_PATTERN),
    applicability: applicabilitySchema,
    prerequisites: z.array(
      z.object({ template_key: z.string().regex(KEY_PATTERN), kind: z.enum(["hard", "soft"]) }).strict(),
    ),
    required_documents: z.array(
      z.object({ name: z.string().min(1), source_key: z.string().regex(KEY_PATTERN).nullable() }).strict(),
    ),
    deadline_rule: z
      .object({
        anchor: z.enum(["arrival_date", "move_in_date", "target_move_date"]),
        offset_days: z.number().int().min(0).max(3650),
        source_key: z.string().regex(KEY_PATTERN),
      })
      .strict()
      .nullable(),
    estimated_duration: z.string().nullable(),
    sources: z.array(
      z
        .object({
          source_key: z.string().regex(KEY_PATTERN),
          supports: z.array(z.enum(SUPPORT_KINDS)).min(1),
          excerpt: z.string().min(1).max(600),
        })
        .strict(),
    ),
    verification_status: z.enum(VERIFICATION_STATUSES),
    last_verified_at: isoDate.nullable(),
    review_notes: z.string().nullable(),
  })
  .strict();
export type Template = z.infer<typeof templateSchema>;

export const evalCaseSchema = z
  .object({
    case_key: z.string().regex(KEY_PATTERN),
    feature: z.enum(["profile_extraction", "rag_answer", "next_action"]),
    scenario: z.string().regex(/^S\d+$/).optional(),
    severity: z.enum(["low", "medium", "high"]),
    tags: z.array(z.string().min(1)).default([]),
    input: z.record(z.string(), z.unknown()),
    expected: z.record(z.string(), z.unknown()),
    forbidden: z.array(z.string().min(1)).default([]),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const requiredKeys: Record<typeof c.feature, string[]> = {
      profile_extraction: ["status", "fields", "missing_fields_include"],
      rag_answer: ["answer_status", "must_cite_source_keys", "must_include_facts", "must_not_include"],
      next_action: ["must_recommend_any", "must_not_recommend", "must_not_use_terms"],
    };
    for (const key of requiredKeys[c.feature]) {
      if (!(key in c.expected)) {
        ctx.addIssue({ code: "custom", message: `${c.case_key}: expected.${key} is required for ${c.feature}` });
      }
    }
  });
export type EvalCase = z.infer<typeof evalCaseSchema>;
