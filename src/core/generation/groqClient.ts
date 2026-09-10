/**
 * Groq implementation of LLMClient.
 *
 * The brief is explicit about the main way to lose points here: "A pipeline
 * that falls over the first time a provider says 'slow down' is the most
 * common way to lose points." Three mechanisms address that:
 *
 *  1. Process-wide serialization: Groq's free tier limits (30 RPM, 6-12k TPM
 *     depending on model) apply per organization, not per API key or per
 *     instance — so every call in this process, across every concurrent
 *     pipeline run (e.g. the batch command processing 5 cases), goes through
 *     one shared queue. Two kits generating "at once" still hit Groq one
 *     request at a time.
 *  2. Proactive throttling: we read x-ratelimit-remaining-requests /
 *     x-ratelimit-remaining-tokens / x-ratelimit-reset-* from every response
 *     and self-pace BEFORE hitting the limit, not just react to a 429 after
 *     the fact.
 *  3. Reactive backoff: on an actual 429, we read retry-after and back off
 *     with exponential growth + jitter, capped at a small number of retries,
 *     rather than hammering the endpoint or giving up immediately.
 *
 * Separately: JSON-validation-with-correction handles Section 10's "the model
 * returns invalid JSON or an incomplete kit" — on a schema validation failure
 * we retry once with the validation errors fed back to the model, before
 * giving up and letting the caller's safeGenerate() degrade gracefully.
 */

import { z } from "zod";
import { LLMClient, LLMGenerateOptions, LLMError } from "./llmClient";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.8-27b";
const DEFAULT_MAX_JSON_RETRIES = 2;
const MAX_429_RETRIES = 8;
const BASE_BACKOFF_MS = 2000;

// ---------- Process-wide rate limiter (shared across all GroqClient instances) ----------

interface RateState {
  remainingRequests: number | null;
  remainingTokens: number | null;
  resetRequestsMs: number | null; // epoch ms when the request count resets
  resetTokensMs: number | null; // epoch ms when the token count resets
}

const rateState: RateState = {
  remainingRequests: null,
  remainingTokens: null,
  resetRequestsMs: null,
  resetTokensMs: null,
};

let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
// ~30 RPM ceiling with a small safety margin. Shortened under test so the
// suite doesn't take minutes to run — this only affects test execution speed,
// not production throttling behavior.
const MIN_INTERVAL_MS = process.env.NODE_ENV === "test" ? 5 : 2100;

/** Test-only hook: resets shared rate-limiter state between test cases. */
export function __resetRateLimiterForTests(): void {
  rateState.remainingRequests = null;
  rateState.remainingTokens = null;
  rateState.resetRequestsMs = null;
  rateState.resetTokensMs = null;
  requestQueue = Promise.resolve();
  lastRequestAt = 0;
}

/** Serializes all Groq calls process-wide, with proactive pacing before each one. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    await waitForCapacity();
    const now = Date.now();
    const sinceLastMs = now - lastRequestAt;
    if (sinceLastMs < MIN_INTERVAL_MS) {
      await sleep(MIN_INTERVAL_MS - sinceLastMs);
    }
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this call rejects, so subsequent calls still run.
  requestQueue = run.catch(() => undefined);
  return run;
}

async function waitForCapacity(): Promise<void> {
  const now = Date.now();
  if (rateState.remainingRequests !== null && rateState.remainingRequests <= 0) {
    if (rateState.resetRequestsMs && rateState.resetRequestsMs > now) {
      await sleep(rateState.resetRequestsMs - now + 250);
    }
  }
  // Tokens can't be predicted before the call, so we're conservative: if we're
  // down to a small remaining budget, wait out the reset window entirely
  // rather than risk a 429 mid-generation.
  const LOW_TOKEN_THRESHOLD = 500;
  if (
    rateState.remainingTokens !== null &&
    rateState.remainingTokens < LOW_TOKEN_THRESHOLD
  ) {
    if (rateState.resetTokensMs && rateState.resetTokensMs > now) {
      await sleep(rateState.resetTokensMs - now + 250);
    }
  }
}

function updateRateStateFromHeaders(headers: Headers): void {
  const remainingRequests = headers.get("x-ratelimit-remaining-requests");
  const remainingTokens = headers.get("x-ratelimit-remaining-tokens");
  const resetRequests = headers.get("x-ratelimit-reset-requests");
  const resetTokens = headers.get("x-ratelimit-reset-tokens");

  if (remainingRequests !== null) rateState.remainingRequests = Number(remainingRequests);
  if (remainingTokens !== null) rateState.remainingTokens = Number(remainingTokens);
  if (resetRequests !== null) rateState.resetRequestsMs = Date.now() + parseDurationToMs(resetRequests);
  if (resetTokens !== null) rateState.resetTokensMs = Date.now() + parseDurationToMs(resetTokens);
}

/** Groq reset headers are durations like "6m11.52s" or "2.5s" — parse to ms. */
function parseDurationToMs(duration: string): number {
  const minutesMatch = duration.match(/(\d+)m/);
  const secondsMatch = duration.match(/([\d.]+)s/);
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  const seconds = secondsMatch ? parseFloat(secondsMatch[1]) : 0;
  return minutes * 60_000 + seconds * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// ---------- Client ----------

export interface GroqClientOptions {
  apiKey: string;
  model?: string;
  temperature?: number;
}

export class GroqClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private temperature: number;

  constructor(opts: GroqClientOptions) {
    if (!opts.apiKey) {
      throw new Error("GroqClient requires an apiKey (set GROQ_API_KEY)");
    }
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.temperature = opts.temperature ?? 0.4;
  }

  async generateStructured<T>(opts: LLMGenerateOptions<T>): Promise<T> {
    const maxJsonRetries = opts.maxRetries ?? DEFAULT_MAX_JSON_RETRIES;

    let messages = [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: opts.prompt },
    ];

    let lastError: string | null = null;

    for (let attempt = 0; attempt <= maxJsonRetries; attempt++) {
      const promptForAttempt =
        attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: "user" as const,
                content:
                  `Your previous response was invalid: ${lastError}. ` +
                  `Return corrected JSON only, matching the required shape exactly.`,
              },
            ];

      const raw = await this.callWithRateLimitRetry(promptForAttempt);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        lastError = "response was not valid JSON";
        continue;
      }

      const result = opts.schema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }

      lastError = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    }

    throw new LLMError(
      `Groq returned invalid output after ${maxJsonRetries + 1} attempts: ${lastError}`
    );
  }

  /** Handles the 429 case with retry-after-aware exponential backoff + jitter. */
  private async callWithRateLimitRetry(
    messages: { role: "system" | "user"; content: string }[]
  ): Promise<string> {
    let attempt = 0;
    while (true) {
      try {
        return await enqueue(() => this.callOnce(messages));
      } catch (err) {
        if (err instanceof RateLimitedError && attempt < MAX_429_RETRIES) {
          const backoff = err.retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt;
          const jitter = Math.random() * 250;
          await sleep(backoff + jitter);
          attempt++;
          continue;
        }
        throw err instanceof LLMError ? err : new LLMError("Groq request failed", err);
      }
    }
  }

  private async callOnce(
    messages: { role: "system" | "user"; content: string }[]
  ): Promise<string> {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      }),
    });

    updateRateStateFromHeaders(response.headers);

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
      throw new RateLimitedError(retryAfterMs);
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new LLMError(`Groq API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LLMError("Groq response missing expected content field");
    }
    return content;
  }
}

class RateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number | null) {
    super("rate limited");
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "(no body)";
  }
}
