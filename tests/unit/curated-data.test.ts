import { describe, expect, it } from "vitest";
import { evalCaseSchema, sourceSchema, templateSchema, type Source, type Template } from "@/lib/validation/data-schemas";
import { loadCuratedData } from "@/server/data/load-curated-data";
import { findPrerequisiteCycle, validateTemplateSet } from "@/server/domain/template-rules";

const data = loadCuratedData();

const source = (over: Partial<Source> = {}): Source => ({
  source_key: "test.source",
  title: "T",
  authority: "A",
  url: "https://example.gov/page",
  language: "de",
  country_code: "DE",
  region_scope: "federal",
  trust_level: "official",
  published_or_updated_at: null,
  checked_at: "2026-11-21",
  checked_by: "human",
  content_hash: null,
  ...over,
});

const template = (over: Partial<Template> = {}): Template => ({
  template_key: "test.a",
  version: 1,
  category: "housing_registration",
  title: "A",
  description: "A",
  region_scope: "federal",
  applicability: { all: [] },
  prerequisites: [],
  required_documents: [],
  deadline_rule: null,
  estimated_duration: null,
  sources: [{ source_key: "test.source", supports: ["existence"], excerpt: "x" }],
  verification_status: "needs_review",
  last_verified_at: null,
  review_notes: null,
  ...over,
});

const rules = (sources: Source[], templates: Template[]) => validateTemplateSet(sources, templates).map((v) => v.rule);

describe("curated data in the repository", () => {
  it("passes schema validation and cross-file rules", () => {
    expect(data.sources.length).toBeGreaterThanOrEqual(14);
    expect(data.templates).toHaveLength(30);
    expect(validateTemplateSet(data.sources, data.templates)).toEqual([]);
  });

  it("covers all six categories", () => {
    expect(new Set(data.templates.map((t) => t.category)).size).toBe(6);
  });

  it("never marks a template verified while its sources are only AI-fetched (D-10)", () => {
    const humanChecked = new Set(data.sources.filter((s) => s.checked_by === "human").map((s) => s.source_key));
    for (const t of data.templates.filter((t) => t.verification_status === "verified")) {
      for (const s of t.sources) expect(humanChecked.has(s.source_key)).toBe(true);
    }
  });

  it("has valid seed evaluation cases for all three AI features (AC-06-1)", () => {
    expect(new Set(data.evalCases.map((c) => c.feature))).toEqual(
      new Set(["profile_extraction", "rag_answer", "next_action"]),
    );
    expect(new Set(data.evalCases.map((c) => c.case_key)).size).toBe(data.evalCases.length);
  });

  it("only cites source keys that exist in eval expectations", () => {
    const keys = new Set(data.sources.map((s) => s.source_key));
    for (const c of data.evalCases.filter((c) => c.feature === "rag_answer")) {
      for (const k of c.expected.must_cite_source_keys as string[]) expect(keys.has(k)).toBe(true);
    }
  });
});

describe("template rules (AC-02-5, AC-03-5)", () => {
  it("accepts a minimal valid set", () => {
    expect(rules([source()], [template()])).toEqual([]);
  });

  it("rejects needs_review without an existence source", () => {
    const t = template({ sources: [{ source_key: "test.source", supports: ["procedure"], excerpt: "x" }] });
    expect(rules([source()], [t])).toContain("existence_source");
  });

  it("rejects verified templates whose source was not reviewed by a human", () => {
    const t = template({ verification_status: "verified", last_verified_at: "2026-11-21" });
    expect(rules([source({ checked_by: "ai_fetch" })], [t])).toContain("human_reviewed_source");
  });

  it("rejects a deadline rule without a deadline source", () => {
    const t = template({ deadline_rule: { anchor: "move_in_date", offset_days: 14, source_key: "test.source" } });
    expect(rules([source()], [t])).toContain("deadline_source");
  });

  it("rejects a required document citing a source without supports=documents", () => {
    const t = template({ required_documents: [{ name: "Pass", source_key: "test.source" }] });
    expect(rules([source()], [t])).toContain("document_source");
  });

  it("rejects unknown sources and prerequisites", () => {
    const t = template({
      sources: [{ source_key: "missing.source", supports: ["existence"], excerpt: "x" }],
      prerequisites: [{ template_key: "missing.template", kind: "hard" }],
    });
    expect(rules([source()], [t])).toEqual(expect.arrayContaining(["known_source", "known_prerequisite"]));
  });

  it("detects prerequisite cycles", () => {
    const a = template({ template_key: "test.a", prerequisites: [{ template_key: "test.b", kind: "hard" }] });
    const b = template({ template_key: "test.b", prerequisites: [{ template_key: "test.c", kind: "soft" }] });
    const c = template({ template_key: "test.c", prerequisites: [{ template_key: "test.a", kind: "hard" }] });
    expect(findPrerequisiteCycle([a, b, c])).toEqual(["test.a", "test.b", "test.c", "test.a"]);
    expect(rules([source()], [a, b, c])).toContain("acyclic_prerequisites");
  });

  it("rejects duplicate keys", () => {
    expect(rules([source(), source({ url: "https://example.gov/2" })], [template(), template()])).toEqual(
      expect.arrayContaining(["unique_source_key", "unique_template_key"]),
    );
  });
});

describe("schemas", () => {
  it("rejects unknown fields and bad enums", () => {
    expect(templateSchema.safeParse({ ...template(), surprise: 1 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...template(), category: "visa" }).success).toBe(false);
    expect(sourceSchema.safeParse(source({ url: "http://insecure.example" })).success).toBe(false);
  });

  it("rejects applicability conditions on fields outside the profile", () => {
    const t = { ...template(), applicability: { all: [{ field: "passport_number", op: "is_set" }] } };
    expect(templateSchema.safeParse(t).success).toBe(false);
  });

  it("requires feature-specific expectation keys in eval cases", () => {
    const bad = { case_key: "rag.x.y", feature: "rag_answer", severity: "high", input: {}, expected: {} };
    expect(evalCaseSchema.safeParse(bad).success).toBe(false);
  });

  it("normalises YAML dates to ISO strings", () => {
    const parsed = sourceSchema.parse({ ...source(), checked_at: new Date("2026-11-21T00:00:00Z") });
    expect(parsed.checked_at).toBe("2026-11-21");
  });
});
