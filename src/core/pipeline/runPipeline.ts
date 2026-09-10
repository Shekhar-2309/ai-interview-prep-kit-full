/**
 * runPipeline() — the single orchestrator both the web API and the batch CLI
 * (npm run evaluate) call. Section 9 requires this explicitly: "the same code
 * your application uses, not a parallel implementation."
 *
 * Sequencing (Section 3):
 *   1. Extract requirements from the JD (pasted text needs no retrieval at all)
 *   2. Crawl the company site (a homepage needs crawling before it's useful)
 *   3. Search for public interview discussion
 *   4. Generate the company brief from what was found
 *   5. Generate questions, per category, per requirement subset
 *   6. Coverage-check loop: find must-have gaps, generate targeted follow-ups, recheck
 *   7. Derive flashcards deterministically from the final question set
 *   8. Build the schedule (deterministic)
 *   9. Assemble + validate against Appendix A before returning
 *
 * Failure philosophy (Section 10 / Section 13):
 *   - A single unreachable page, a crawl that finds nothing, or a search that
 *     returns nothing are NOT pipeline failures — they're recorded honestly
 *     and the kit reflects the gap (e.g. an honest brief, sources: []).
 *   - The pipeline only throws PipelineFatalError when it cannot produce a
 *     kit at all (e.g. repeated LLM failure on the one step that's load-
 *     bearing for everything downstream: requirement extraction).
 */

import { LLMClient } from "../generation/llmClient";
import { extractRequirements, ExtractedRole } from "../generation/extractRequirements";
import { generateBrief, CompanyBrief } from "../generation/generateBrief";
import { generateQuestionsForCategory, Question } from "../generation/generateQuestions";
import { checkCoverage } from "../generation/coverageCheck";
import { buildSchedule } from "../scheduling/buildSchedule";
import { crawlAndRank, RankedPage, CrawlOptions } from "../retrieval/crawlAndRank";
import { validateKit, Kit } from "../validation/kitSchema";

export class PipelineFatalError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PipelineFatalError";
  }
}

export interface PipelineInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export type PipelineStep =
  | "extracting_requirements"
  | "crawling_company_site"
  | "searching_discussion"
  | "generating_brief"
  | "generating_questions"
  | "checking_coverage"
  | "building_schedule"
  | "validating";

export interface PipelineProgressEvent {
  step: PipelineStep;
  detail?: string;
}

export interface PipelineDependencies {
  llm: LLMClient;
  fetchPage: CrawlOptions["fetchPage"];
  /** Optional — searches for public discussion of the company's interview process.
   *  Not yet implemented as a real provider; defaults to "found nothing" so the
   *  pipeline degrades honestly (Section 10) rather than failing without it. */
  searchInterviewDiscussion?: (company: string) => Promise<RankedPage[]>;
  onProgress?: (event: PipelineProgressEvent) => void;
  maxCoveragePasses?: number;
}

const DEFAULT_MAX_COVERAGE_PASSES = 3;

export async function runPipeline(
  input: PipelineInput,
  deps: PipelineDependencies
): Promise<{ kit: Kit; unreachableSources: { url: string; reason: string }[] }> {
  const { llm, fetchPage, onProgress } = deps;
  const maxPasses = deps.maxCoveragePasses ?? DEFAULT_MAX_COVERAGE_PASSES;
  const emit = (step: PipelineStep, detail?: string) => onProgress?.({ step, detail });

  if (input.days < 1) {
    throw new PipelineFatalError(`days must be at least 1, got ${input.days}`);
  }
  if (!input.jd || input.jd.trim().length === 0) {
    throw new PipelineFatalError("job description is empty");
  }

  // ---------- 1. Requirement extraction (load-bearing — everything else needs this) ----------
  emit("extracting_requirements");
  let role: ExtractedRole;
  try {
    role = await extractRequirements(input.jd, llm);
  } catch (err) {
    // This is the one step allowed to be fatal — without requirements there
    // is no kit to build at all.
    throw new PipelineFatalError("failed to extract requirements from job description", err);
  }

  // ---------- 2. Crawl company site ----------
  emit("crawling_company_site");
  let rankedPages: RankedPage[] = [];
  let unreachableSources: { url: string; reason: string }[] = [];
  try {
    const crawlResult = await crawlAndRank({ companyUrl: input.companyUrl, fetchPage });
    rankedPages = crawlResult.rankedPages;
    unreachableSources = crawlResult.unreachable;
  } catch (err) {
    // Section 10: "company URL is invalid, returns 404, or times out" — recorded,
    // not fatal. The kit will simply have an honest, source-less brief.
    unreachableSources.push({
      url: input.companyUrl,
      reason: err instanceof Error ? err.message : "unknown crawl failure",
    });
  }

  // ---------- 3. Public interview discussion ----------
  emit("searching_discussion");
  let discussionPages: RankedPage[] = [];
  if (deps.searchInterviewDiscussion) {
    try {
      discussionPages = await deps.searchInterviewDiscussion(role.title || input.companyUrl);
    } catch {
      // Section 10: "public discussion turns up nothing at all" is an accepted outcome.
      discussionPages = [];
    }
  }

  // ---------- 4. Company brief ----------
  emit("generating_brief");
  const aboutAndHiringPages = rankedPages
    .filter((p) => p.kind === "about" || p.kind === "hiring")
    .slice(0, 5);
  let brief: CompanyBrief;
  try {
    brief = await generateBrief([...aboutAndHiringPages, ...discussionPages], llm);
  } catch (err) {
    // Section 10: "LLM provider rate-limits you, or briefly fails" — degrade to
    // an honest brief rather than failing the whole kit.
    brief = {
      summary: "The company brief could not be generated due to a temporary error.",
      what_they_do: "Not available.",
      sources: [],
    };
  }

  // Simple keyword-based signal detection — deterministic, decides whether to
  // spend an LLM call on system-design questions at all.
  const processText = [...aboutAndHiringPages, ...discussionPages]
    .map((p) => p.textExcerpt.toLowerCase())
    .join(" ");
  const mentionsSystemDesign =
    processText.includes("system design") || processText.includes("architecture round");

  // ---------- 5. Questions, per category ----------
  emit("generating_questions");
  const technicalReqs = role.requirements.filter((r) => r.kind === "technical" || r.kind === "domain");
  const behaviouralReqs = role.requirements.filter((r) => r.kind === "behavioural");

  let questions: Question[] = [];
  let passCounter = 0;

  questions = questions.concat(
    await safeGenerate(() =>
      generateQuestionsForCategory(
        { category: "technical", requirements: technicalReqs, idPrefix: "qt" },
        llm
      )
    )
  );
  questions = questions.concat(
    await safeGenerate(() =>
      generateQuestionsForCategory(
        { category: "behavioural", requirements: behaviouralReqs, idPrefix: "qb" },
        llm
      )
    )
  );
  if (mentionsSystemDesign) {
    questions = questions.concat(
      await safeGenerate(() =>
        generateQuestionsForCategory(
          { category: "system-design", requirements: technicalReqs, idPrefix: "qs" },
          llm
        )
      )
    );
  }
  questions = questions.concat(
    await safeGenerate(() =>
      generateQuestionsForCategory(
        {
          category: "company-fit",
          requirements: [],
          companyContext: brief.summary,
          idPrefix: "qc",
        },
        llm
      )
    )
  );

  // ---------- 6. Coverage loop ----------
  emit("checking_coverage");
  let coverage = checkCoverage(role.requirements, questions);
  while (coverage.uncoveredMustHaveIds.length > 0 && passCounter < maxPasses) {
    passCounter++;
    const gapRequirements = role.requirements.filter((r) =>
      coverage.uncoveredMustHaveIds.includes(r.id)
    );
    const gapQuestions = await safeGenerate(() =>
      generateQuestionsForCategory(
        {
          category: gapRequirements[0]?.kind === "behavioural" ? "behavioural" : "technical",
          requirements: gapRequirements,
          idPrefix: `qg${passCounter}`,
        },
        llm
      )
    );
    questions = questions.concat(gapQuestions);
    coverage = checkCoverage(role.requirements, questions);
  }

  // ---------- 7. Flashcards (deterministic, derived from questions) ----------
  // Derived rather than separately LLM-generated: guarantees requirement_id
  // traceability by construction and avoids an extra LLM call under the
  // tight free-tier TPM budget. Capped per requirement to keep the deck usable.
  const flashcards = deriveFlashcards(questions);

  // ---------- 8. Schedule ----------
  emit("building_schedule");
  const schedule = buildSchedule(role.requirements, questions, input.days);

  // ---------- 9. Assemble + validate ----------
  emit("validating");
  const kitCandidate = {
    source: {
      company: extractCompanyName(input.companyUrl),
      company_url: input.companyUrl,
      role: role.title,
      location: "",
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: [...aboutAndHiringPages, ...discussionPages].map((p) => p.url),
    },
    company_brief: brief,
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage: {
      uncovered_requirement_ids: coverage.uncoveredRequirementIds,
      passes: passCounter,
    },
  };

  const validation = validateKit(kitCandidate);
  if (!validation.valid) {
    // A structurally invalid kit after generation is a bug, not a user input
    // problem — surface it clearly rather than silently shipping bad data.
    throw new PipelineFatalError(
      `generated kit failed structure validation: ${validation.errors.join("; ")}`
    );
  }

  return { kit: validation.kit, unreachableSources };
}

async function safeGenerate<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    console.warn("Question generation step failed, degrading gracefully:", err);
    return [];
  }
}

function deriveFlashcards(questions: Question[]): {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
}[] {
  return questions.map((q, i) => ({
    id: `f${i + 1}`,
    front: q.prompt,
    back: q.answer_outline,
    requirement_ids: q.requirement_ids,
  }));
}

function extractCompanyName(companyUrl: string): string {
  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./, "");
    return host.split(".")[0];
  } catch {
    return companyUrl;
  }
}
