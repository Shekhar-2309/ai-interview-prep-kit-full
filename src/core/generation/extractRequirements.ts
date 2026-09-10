/**
 * Extracts structured requirements from a pasted job description.
 *
 * Section 5's rule that "every requirement gets a stable id" is enforced here in
 * code, not left to the model — we never trust the LLM to emit consistent ids.
 * The model returns raw requirement text/kind/priority; we assign r1, r2, ... after.
 *
 * Section 10 edge case: "the job description is a two-line stub with almost
 * nothing to extract" — we do not pad the result. A thin JD legitimately
 * produces a short requirements list. Section 5's "must vs nice" distinction
 * comes directly from the posting's own wording ("required" vs "bonus points
 * for"), which we instruct the model to honor rather than guess.
 */

import { z } from "zod";
import { LLMClient } from "./llmClient";

const ExtractedRequirementSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["technical", "behavioural", "domain"]),
  priority: z.enum(["must", "nice"]),
});

const ExtractionResultSchema = z.object({
  requirements: z.array(ExtractedRequirementSchema),
  responsibilities: z.array(z.string()),
  title: z.string(),
  seniority: z.string(),
});

export interface Requirement {
  id: string;
  text: string;
  kind: "technical" | "behavioural" | "domain";
  priority: "must" | "nice";
}

export interface ExtractedRole {
  title: string;
  seniority: string;
  responsibilities: string[];
  requirements: Requirement[];
}

const SYSTEM_PROMPT = `You extract structured requirements from job descriptions.
Rules:
- Only extract what is actually stated. Never invent requirements the text doesn't support.
- priority "must" = the posting states this as required/essential (e.g. "required", "must have", "you will need").
- priority "nice" = the posting frames this as a bonus (e.g. "nice to have", "bonus points for", "preferred but not required").
- kind "technical" = specific tools/languages/systems experience.
- kind "behavioural" = soft skills, collaboration, leadership, mentoring.
- kind "domain" = industry/domain-specific knowledge (e.g. "experience in fintech", "healthcare compliance").
- If the description is thin, return a short list. Do not pad it to look complete.
Return JSON only, matching the given schema.`;

export async function extractRequirements(
  jd: string,
  llm: LLMClient
): Promise<ExtractedRole> {
  const result = await llm.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: `Job description:\n\n${jd}`,
    schema: ExtractionResultSchema,
  });

  const requirements: Requirement[] = result.requirements.map((r, i) => ({
    id: `r${i + 1}`,
    text: r.text,
    kind: r.kind,
    priority: r.priority,
  }));

  return {
    title: result.title,
    seniority: result.seniority,
    responsibilities: result.responsibilities,
    requirements,
  };
}
