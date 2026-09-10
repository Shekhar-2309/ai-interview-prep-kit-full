import { z } from "zod";

export const RegisterRequestSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const LoginRequestSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const CreateKitRequestSchema = z.object({
  jd: z.string().min(1, "job description is required"),
  companyUrl: z.string().url("companyUrl must be a valid URL"),
  days: z.number().int().min(1).max(90),
});

/** Section 2: "a way to prepare for more than one role — uploading a file of
 *  description-and-company pairs." */
export const BatchCreateKitRequestSchema = z.object({
  cases: z
    .array(
      z.object({
        jd: z.string().min(1),
        companyUrl: z.string().url(),
        days: z.number().int().min(1).max(90),
      })
    )
    .min(1)
    .max(20), // reasonable ceiling so one request can't queue an unbounded amount of Groq calls
});

export const EditQuestionRequestSchema = z.object({
  prompt: z.string().min(1).optional(),
  answer_outline: z.string().optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
});

export const EditBriefRequestSchema = z.object({
  summary: z.string().min(1).optional(),
  what_they_do: z.string().optional(),
});

export const EditFlashcardRequestSchema = z.object({
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
});

export const MoveQuestionRequestSchema = z.object({
  category: z.enum(["technical", "behavioural", "system-design", "company-fit"]),
});

export const ReorderQuestionsRequestSchema = z.object({
  /** Full ordered list of question ids for the affected category. */
  orderedIds: z.array(z.string().min(1)),
});

export const AddQuestionRequestSchema = z.object({
  category: z.enum(["technical", "behavioural", "system-design", "company-fit"]),
  requirement_ids: z.array(z.string()).default([]),
  prompt: z.string().min(1),
  answer_outline: z.string().default(""),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const AddFlashcardRequestSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()).default([]),
});

export const RegenerateSectionRequestSchema = z.object({
  section: z.enum(["company_brief", "schedule", "questions"]),
  /** Required when section === "questions" — which category to regenerate. */
  category: z.enum(["technical", "behavioural", "system-design", "company-fit"]).optional(),
  force: z.boolean().default(false),
});

export const PracticeRecordRequestSchema = z.object({
  flashcardId: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
});
