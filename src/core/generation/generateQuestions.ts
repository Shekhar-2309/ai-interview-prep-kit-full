/**
 * Generates interview questions for ONE category at a time, against a specific
 * subset of requirements. Called multiple times by the pipeline (once per
 * category, and again per coverage-gap pass) rather than once for everything —
 * this is the "sequence of deliberate steps" Section 3 asks for, not a single
 * prompt that returns the whole kit.
 *
 * Each category gets its own system prompt, because "five years of React"
 * and "mentors junior engineers" genuinely need different question-writing
 * instructions, not just a category label slapped on generic output.
 */

import { z } from "zod";
import { LLMClient } from "./llmClient";
import { Requirement } from "./extractRequirements";

export type QuestionCategory =
  | "technical"
  | "behavioural"
  | "system-design"
  | "company-fit";

export interface Question {
  id: string;
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
}

const GeneratedQuestionSchema = z.object({
  requirement_ids: z.array(z.string()),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const QuestionBatchSchema = z.preprocess(
  (val) => (Array.isArray(val) ? { questions: val } : val),
  z.object({
  questions: z.array(GeneratedQuestionSchema),
  })
);

const CATEGORY_INSTRUCTIONS: Record<QuestionCategory, string> = {
  technical:
    "Write hands-on technical interview questions that test real depth in the " +
    "specific tools/technologies named in the requirements — not generic " +
    "trivia. Prefer questions that reveal whether the candidate has actually " +
    "used the technology under real constraints.",
  behavioural:
    "Write behavioural interview questions (STAR-style) that probe the soft " +
    "skills and collaboration/leadership qualities named in the requirements. " +
    "Avoid generic 'tell me about a time' filler — tie each question to the " +
    "specific requirement.",
  "system-design":
    "Write system-design interview questions appropriate to the seniority " +
    "and technical requirements given. Scale scope to seniority — do not ask " +
    "a junior-level design question of a requirement that implies senior " +
    "scope, or vice versa.",
  "company-fit":
    "Write company-fit / culture questions based on the company brief " +
    "provided, testing whether the candidate has genuinely engaged with what " +
    "this specific company does and how they work — not generic 'why do you " +
    "want to work here' filler.",
};

export interface GenerateQuestionsInput {
  category: QuestionCategory;
  requirements: Requirement[]; // only the requirements this call should cover
  companyContext?: string; // brief summary, used for company-fit category
  idPrefix: string; // caller controls id numbering to guarantee uniqueness across calls
}

export async function generateQuestionsForCategory(
  input: GenerateQuestionsInput,
  llm: LLMClient
): Promise<Question[]> {
  if (input.requirements.length === 0 && input.category !== "company-fit") {
    return []; // nothing to ask about — do not fabricate requirements to cover
  }

  const requirementList = input.requirements
    .map((r) => `- [${r.id}] (${r.priority}) ${r.text}`)
    .join("\n");

  const contextBlock = input.companyContext
    ? `\n\nCompany context:\n${input.companyContext}`
    : "";

  const system =
    `You generate interview questions for the "${input.category}" category. ` +
    CATEGORY_INSTRUCTIONS[input.category] +
    ` Every question must include requirement_ids referencing the requirement ` +
    `id(s) it covers from the list given. difficulty is an integer 1-3. ` +
    `Generate one question per requirement listed (more only if genuinely ` +
    `useful). Return JSON only.`;

  const prompt =
    `Requirements to cover:\n${requirementList || "(none — use company context only)"}` +
    contextBlock;

  const result = await llm.generateStructured({
    system,
    prompt,
    schema: QuestionBatchSchema,
  });

    return (result as any).questions.map((q: any, i: number) => ({
    id: `${input.idPrefix}${i + 1}`,
    requirement_ids: q.requirement_ids,
    category: input.category,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    difficulty: q.difficulty,
  }));
}
