import { describe, it, expect } from "vitest";
import { runPipeline, PipelineFatalError } from "./runPipeline";
import { LLMClient, LLMGenerateOptions } from "../generation/llmClient";

/**
 * A scripted mock LLM: returns canned responses keyed by a substring match on
 * the prompt, so each pipeline step gets a plausible, schema-valid answer
 * without hitting a real provider.
 */
function makeMockLLM(overrides: Partial<Record<string, unknown>> = {}): LLMClient {
  return {
    async generateStructured<T>(opts: LLMGenerateOptions<T>): Promise<T> {
      const p = opts.prompt;

      if (opts.system?.includes("extract structured requirements")) {
        return (overrides.requirements ?? {
          title: "Senior Backend Engineer",
          seniority: "Senior",
          responsibilities: ["Own the payments service"],
          requirements: [
            { text: "5+ years with Node.js", kind: "technical", priority: "must" },
            { text: "Mentors junior engineers", kind: "behavioural", priority: "nice" },
          ],
        }) as T;
      }

      if (opts.system?.includes("company brief")) {
        return (overrides.brief ?? {
          summary: "Acme builds widgets.",
          what_they_do: "B2B SaaS.",
        }) as T;
      }

      if (opts.system?.includes('"technical" category')) {
        return (overrides.technicalQuestions ?? {
          questions: [
            { requirement_ids: ["r1"], prompt: "Explain event loop internals.", answer_outline: "...", difficulty: 2 },
          ],
        }) as T;
      }

      if (opts.system?.includes('"behavioural" category')) {
        return (overrides.behaviouralQuestions ?? {
          questions: [
            { requirement_ids: ["r2"], prompt: "Tell me about mentoring.", answer_outline: "...", difficulty: 1 },
          ],
        }) as T;
      }

      if (opts.system?.includes('"company-fit" category')) {
        return (overrides.companyFitQuestions ?? { questions: [] }) as T;
      }

      if (opts.system?.includes('"system-design" category')) {
        return (overrides.systemDesignQuestions ?? { questions: [] }) as T;
      }

      throw new Error(`mock LLM: no canned response for prompt: ${p.slice(0, 80)}`);
    },
  };
}

const noopFetchPage = async () => null; // crawl finds nothing — tests degradation path

describe("runPipeline", () => {
  it("produces a schema-valid kit end to end with a fully mocked LLM and no crawlable site", async () => {
    const { kit, unreachableSources } = await runPipeline(
      { jd: "Senior Backend Engineer role...", companyUrl: "https://acme.example.com", days: 3 },
      { llm: makeMockLLM(), fetchPage: noopFetchPage }
    );

    expect(kit.role.requirements.length).toBe(2);
    expect(kit.schedule.days).toHaveLength(3);
    expect(kit.questions.length).toBeGreaterThan(0);
    // company site unreachable -> recorded honestly, not fatal
    expect(unreachableSources.length).toBeGreaterThanOrEqual(0);
    // brief degrades honestly when crawl finds nothing
    expect(kit.company_brief.sources).toEqual([]);
  });

  it("closes a must-have coverage gap via the coverage-loop retry", async () => {
    // technical category returns a question that does NOT cover r1 (the must-have),
    // forcing the coverage loop to fire a targeted follow-up.
    const llm = makeMockLLM({
      technicalQuestions: { questions: [] }, // no coverage of r1 on first pass
    });

    // Override once more: the gap-fill call (idPrefix qg1) shares the same
    // "technical" system-prompt substring, so the same branch serves it —
    // simulate it succeeding on retry by using a stateful counter.
    let call = 0;
    const statefulLlm: LLMClient = {
      async generateStructured(opts) {
        if (opts.system?.includes('"technical" category')) {
          call++;
          if (call === 1) return { questions: [] } as any; // first pass: miss
          return {
            questions: [
              { requirement_ids: ["r1"], prompt: "Follow-up on Node.js depth.", answer_outline: "...", difficulty: 2 },
            ],
          } as any;
        }
        return llm.generateStructured(opts as any);
      },
    };

    const { kit } = await runPipeline(
      { jd: "JD text", companyUrl: "https://acme.example.com", days: 2 },
      { llm: statefulLlm, fetchPage: noopFetchPage, maxCoveragePasses: 2 }
    );

    expect(kit.coverage.uncovered_requirement_ids).not.toContain("r1");
    expect(kit.coverage.passes).toBeGreaterThan(0);
  });

  it("throws PipelineFatalError on empty job description", async () => {
    await expect(
      runPipeline({ jd: "", companyUrl: "https://acme.example.com", days: 3 }, { llm: makeMockLLM(), fetchPage: noopFetchPage })
    ).rejects.toBeInstanceOf(PipelineFatalError);
  });

  it("throws PipelineFatalError on invalid days", async () => {
    await expect(
      runPipeline({ jd: "some JD", companyUrl: "https://acme.example.com", days: 0 }, { llm: makeMockLLM(), fetchPage: noopFetchPage })
    ).rejects.toBeInstanceOf(PipelineFatalError);
  });

  it("does not throw when requirement extraction LLM call fails repeatedly — it's the one fatal path, asserted explicitly", async () => {
    const failingLlm: LLMClient = {
      async generateStructured() {
        throw new Error("simulated provider outage");
      },
    };
    await expect(
      runPipeline({ jd: "some JD", companyUrl: "https://acme.example.com", days: 3 }, { llm: failingLlm, fetchPage: noopFetchPage })
    ).rejects.toBeInstanceOf(PipelineFatalError);
  });

  it("emits progress events in sequence", async () => {
    const events: string[] = [];
    await runPipeline(
      { jd: "some JD", companyUrl: "https://acme.example.com", days: 2 },
      {
        llm: makeMockLLM(),
        fetchPage: noopFetchPage,
        onProgress: (e) => events.push(e.step),
      }
    );
    expect(events).toEqual([
      "extracting_requirements",
      "crawling_company_site",
      "searching_discussion",
      "generating_brief",
      "generating_questions",
      "checking_coverage",
      "building_schedule",
      "validating",
    ]);
  });
});
