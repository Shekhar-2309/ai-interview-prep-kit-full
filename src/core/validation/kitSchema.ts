/**
 * Appendix A kit structure — schema + validation.
 *
 * Two layers, deliberately kept separate:
 *  1. Structural validation (zod): field names, types, enums match Appendix A exactly.
 *  2. Referential integrity (superRefine): ids referenced across sections actually exist,
 *     schedule.days.length matches days_available, etc.
 *
 * This module does NOT enforce coverage completeness (e.g. "every must-have requirement
 * has a question") — that's a pipeline-level business rule (see core/generation/coverageCheck.ts),
 * not a structural constraint. A kit mid-edit in the Builder may legitimately have gaps
 * temporarily; the schema should still accept it as a valid *shape*.
 *
 * .passthrough() is used on objects so we can attach builder metadata (origin/locked, see
 * core/builder/kitState.ts) without breaking "required fields must be present and named
 * exactly as given." Use `toAppendixA()` below to strip that metadata before batch output
 * or automated grading, guaranteeing an exact-shape match.
 */

import { z } from "zod";

// ---------- Leaf enums ----------

const RequirementKind = z.enum(["technical", "behavioural", "domain"]);
const RequirementPriority = z.enum(["must", "nice"]);
const QuestionCategory = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);

const isoDateString = z
  .string()
  .refine((val) => !Number.isNaN(Date.parse(val)), {
    message: "must be a valid ISO 8601 date string",
  });

const urlString = z.string().url();

// ---------- Sections ----------

const SourceSchema = z
  .object({
    company: z.string(),
    company_url: urlString,
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().nonnegative(),
    researched_at: isoDateString,
    pages_used: z.array(urlString),
  })
  .passthrough();

const CompanyBriefSchema = z
  .object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(urlString),
  })
  .passthrough();

const RequirementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    kind: RequirementKind,
    priority: RequirementPriority,
  })
  .passthrough();

const RoleSchema = z
  .object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(RequirementSchema),
  })
  .passthrough();

const QuestionSchema = z
  .object({
    id: z.string().min(1),
    requirement_ids: z.array(z.string().min(1)),
    category: QuestionCategory,
    prompt: z.string().min(1),
    answer_outline: z.string(),
    difficulty: z.number().int().min(1).max(3),
  })
  .passthrough();

const FlashcardSchema = z
  .object({
    id: z.string().min(1),
    front: z.string().min(1),
    back: z.string().min(1),
    requirement_ids: z.array(z.string().min(1)),
  })
  .passthrough();

const ScheduleDaySchema = z
  .object({
    day: z.number().int().positive(),
    focus: z.string(),
    question_ids: z.array(z.string().min(1)),
    minutes: z.number().int().nonnegative(),
  })
  .passthrough();

const ScheduleSchema = z
  .object({
    days_available: z.number().int().positive(),
    days: z.array(ScheduleDaySchema),
  })
  .passthrough();

const CoverageSchema = z
  .object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int().nonnegative(),
  })
  .passthrough();

// ---------- Top-level kit ----------

export const KitSchemaBase = z
  .object({
    source: SourceSchema,
    company_brief: CompanyBriefSchema,
    role: RoleSchema,
    questions: z.array(QuestionSchema),
    flashcards: z.array(FlashcardSchema),
    schedule: ScheduleSchema,
    coverage: CoverageSchema,
  })
  .passthrough();

export type Kit = z.infer<typeof KitSchemaBase>;

/**
 * Full schema including cross-referential checks that zod's per-field validators
 * can't express alone.
 */
export const KitSchema = KitSchemaBase.superRefine((kit, ctx) => {
  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
  const questionIds = new Set(kit.questions.map((q) => q.id));

  // Duplicate id checks
  assertUnique(kit.role.requirements.map((r) => r.id), "role.requirements[].id", ctx);
  assertUnique(kit.questions.map((q) => q.id), "questions[].id", ctx);
  assertUnique(kit.flashcards.map((f) => f.id), "flashcards[].id", ctx);

  // Questions must reference real requirements
  kit.questions.forEach((q, i) => {
    q.requirement_ids.forEach((rid) => {
      if (!requirementIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", i, "requirement_ids"],
          message: `references unknown requirement id "${rid}"`,
        });
      }
    });
  });

  // Flashcards must reference real requirements
  kit.flashcards.forEach((f, i) => {
    f.requirement_ids.forEach((rid) => {
      if (!requirementIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flashcards", i, "requirement_ids"],
          message: `references unknown requirement id "${rid}"`,
        });
      }
    });
  });

  // Schedule days must reference real questions
  kit.schedule.days.forEach((day, i) => {
    day.question_ids.forEach((qid) => {
      if (!questionIds.has(qid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["schedule", "days", i, "question_ids"],
          message: `references unknown question id "${qid}"`,
        });
      }
    });
  });

  // Schedule length must equal days_available (Section 8: "exactly that many days")
  if (kit.schedule.days.length !== kit.schedule.days_available) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schedule", "days"],
      message: `schedule has ${kit.schedule.days.length} day(s) but days_available is ${kit.schedule.days_available}`,
    });
  }

  // coverage.uncovered_requirement_ids must reference real requirements
  kit.coverage.uncovered_requirement_ids.forEach((rid) => {
    if (!requirementIds.has(rid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "uncovered_requirement_ids"],
        message: `references unknown requirement id "${rid}"`,
      });
    }
  });
});

function assertUnique(ids: string[], path: string, ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: `duplicate id "${id}"`,
      });
    }
    seen.add(id);
  }
}

/** Result type used by the API/pipeline layer so callers don't need to know about zod. */
export type ValidationResult =
  | { valid: true; kit: Kit }
  | { valid: false; errors: string[] };

export function validateKit(data: unknown): ValidationResult {
  const result = KitSchema.safeParse(data);
  if (result.success) {
    return { valid: true, kit: result.data };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
  return { valid: false, errors };
}

/**
 * Strict (non-passthrough) mirror of the schema, used only to strip unknown keys.
 * z.object() defaults to "strip" mode, so re-parsing through this removes any
 * builder metadata (origin/locked, etc.) that the passthrough schema above allowed in.
 */
const AppendixARequirement = RequirementSchema.strip();
const AppendixAQuestion = QuestionSchema.strip();
const AppendixAFlashcard = FlashcardSchema.strip();
const AppendixAScheduleDay = ScheduleDaySchema.strip();

const AppendixAStrict = z.object({
  source: SourceSchema.strip(),
  company_brief: CompanyBriefSchema.strip(),
  role: RoleSchema.strip().extend({ requirements: z.array(AppendixARequirement) }),
  questions: z.array(AppendixAQuestion),
  flashcards: z.array(AppendixAFlashcard),
  schedule: ScheduleSchema.strip().extend({ days: z.array(AppendixAScheduleDay) }),
  coverage: CoverageSchema.strip(),
});

/**
 * Strips any non-Appendix-A fields (e.g. builder metadata like `origin`/`locked`)
 * before writing batch output or comparing against the grading harness. Guarantees
 * exact structural conformance regardless of what extensions the app adds internally.
 */
export function toAppendixA(kit: Kit): z.infer<typeof AppendixAStrict> {
  return AppendixAStrict.parse(kit);
}
