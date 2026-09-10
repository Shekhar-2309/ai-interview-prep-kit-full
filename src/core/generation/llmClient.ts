/**
 * Provider-agnostic LLM client interface.
 *
 * Generation modules depend on this interface, not on Groq directly — keeps
 * the pipeline testable with a mock, and keeps "which provider" a one-file
 * decision (core/generation/groqClient.ts implements this).
 */

import { z } from "zod";

export interface LLMGenerateOptions<T> {
  system?: string;
  prompt: string;
  /** Output must validate against this schema. Client retries with a correction
   *  prompt on parse/validation failure — see Section 10: "model returns invalid JSON". */
  schema: z.ZodType<T>;
  maxRetries?: number;
}

export interface LLMClient {
  generateStructured<T>(opts: LLMGenerateOptions<T>): Promise<T>;
}

/**
 * Thrown when the LLM call ultimately fails after retries (rate limit exhausted,
 * or repeated invalid output). The pipeline catches this per-step and degrades
 * gracefully rather than failing the whole kit — see runPipeline.ts.
 */
export class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LLMError";
  }
}
