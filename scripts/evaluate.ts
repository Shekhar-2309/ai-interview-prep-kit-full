/**
 * Batch entry point — Section 9 (mandatory, exact command):
 *
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Deliberately does NOT touch Mongo, sessions, or Express — this only needs
 * core/pipeline/runPipeline.ts plus a Groq client and a real fetchPage, which
 * is exactly what "the same code your application uses, not a parallel
 * implementation" means: the orchestrator is shared, the surrounding
 * plumbing (persistence, auth, HTTP) is not, because the batch command has
 * none of that.
 *
 * Concurrency: cases run concurrently up to CONCURRENCY. This does NOT
 * bypass the Groq rate limit — groqClient.ts's request queue is
 * process-wide, so LLM calls from every concurrent case still serialize
 * through one shared queue. Concurrency here only overlaps the
 * network-bound crawl/search steps across cases, which is what makes the
 * "5 cases within 15 minutes" budget achievable.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { runPipeline, PipelineFatalError } from "../src/core/pipeline/runPipeline";
import { GroqClient } from "../src/core/generation/groqClient";
import { makeFetchPage } from "../src/server/services/fetchPage";
import { toAppendixA } from "../src/core/validation/kitSchema";

const CONCURRENCY = 1;

const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string().min(1),
  company_url: z.string().url(),
  days: z.number().int().min(1),
});
const CasesFileSchema = z.array(CaseSchema);

interface KitResult {
  id: string;
  status: "ok" | "failed";
  kit: unknown | null;
  error: { code: string; message: string } | null;
}

function parseArgs(argv: string[]): { input: string; output: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") args.input = argv[++i];
    if (argv[i] === "--output") args.output = argv[++i];
  }
  if (!args.input || !args.output) {
    throw new Error(
      "usage: npm run evaluate -- --input <cases.json> --output <kits.json>"
    );
  }
  return { input: args.input, output: args.output };
}

/** Minimal concurrency-limited map — avoids pulling in a dependency for
 *  something this small, and keeps the rate-limiting story easy to explain
 *  in the README (it's just Promise.all over chunks). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function errorCodeFor(err: unknown): string {
  if (err instanceof PipelineFatalError) return "PIPELINE_FATAL";
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  if (message.includes("unreachable") || message.includes("econnrefused") || message.includes("timeout")) {
    return "COMPANY_UNREACHABLE";
  }
  return "UNKNOWN_ERROR";
}

export { parseArgs, mapWithConcurrency, errorCodeFor, CasesFileSchema };

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY is not set — see .env.example");
  }

  const rawInput = await fs.readFile(path.resolve(input), "utf-8");
  const cases = CasesFileSchema.parse(JSON.parse(rawInput));

  const llm = new GroqClient({ apiKey: groqApiKey });
  // isProduction: false here is deliberate, not an oversight — Section 9
  // states company sites used with this command "may be served from a local
  // address," so the SSRF guard must not reject localhost fixtures. A real
  // production deployment's web app uses config.isProduction instead (see
  // server/services/fetchPage.ts callers in generationService.ts).
  const fetchPage = makeFetchPage({ isProduction: false });

  const results: KitResult[] = await mapWithConcurrency(cases, CONCURRENCY, async (c) => {
    try {
      const { kit } = await runPipeline(
        { jd: c.jd, companyUrl: c.company_url, days: c.days },
        { llm, fetchPage }
      );
      return { id: c.id, status: "ok", kit: toAppendixA(kit), error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      return {
        id: c.id,
        status: "failed",
        kit: null,
        error: { code: errorCodeFor(err), message },
      };
    }
  });

  const outputPayload = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits: results,
  };

  await fs.writeFile(path.resolve(output), JSON.stringify(outputPayload, null, 2), "utf-8");

  const okCount = results.filter((r) => r.status === "ok").length;
  // eslint-disable-next-line no-console
  console.log(`Wrote ${results.length} kit(s) to ${output} (${okCount} ok, ${results.length - okCount} failed)`);
}

function isRunDirectly(): boolean {
  try {
    return require.main === module;
  } catch {
    return false; // under a test runner's module system — never auto-run main()
  }
}

if (isRunDirectly()) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("evaluate failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
