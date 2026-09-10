import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { GroqClient, __resetRateLimiterForTests } from "./groqClient";
import { LLMError } from "./llmClient";

const schema = z.object({ answer: z.string() });

function mockResponse(opts: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}): Response {
  return {
    status: opts.status,
    ok: opts.status >= 200 && opts.status < 300,
    headers: new Headers(opts.headers ?? {}),
    json: async () => opts.body,
    text: async () => JSON.stringify(opts.body),
  } as unknown as Response;
}

function groqBody(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  __resetRateLimiterForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GroqClient.generateStructured", () => {
  it("returns parsed, schema-valid output on the first successful call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 200, body: groqBody(JSON.stringify({ answer: "42" })) })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GroqClient({ apiKey: "test-key" });
    const result = await client.generateStructured({ prompt: "what is the answer", schema });

    expect(result).toEqual({ answer: "42" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries with a correction prompt when the model returns invalid JSON, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 200, body: groqBody("not json at all") }))
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: groqBody(JSON.stringify({ answer: "corrected" })) })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GroqClient({ apiKey: "test-key" });
    const result = await client.generateStructured({ prompt: "p", schema, maxRetries: 2 });

    expect(result).toEqual({ answer: "corrected" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // second call should include the correction instruction
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const lastMessage = secondCallBody.messages[secondCallBody.messages.length - 1];
    expect(lastMessage.content).toMatch(/invalid/i);
  });

  it("retries when output is valid JSON but fails schema validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: groqBody(JSON.stringify({ wrong_field: 1 })) })
      )
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: groqBody(JSON.stringify({ answer: "fixed" })) })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GroqClient({ apiKey: "test-key" });
    const result = await client.generateStructured({ prompt: "p", schema, maxRetries: 2 });
    expect(result).toEqual({ answer: "fixed" });
  });

  it("throws LLMError after exhausting JSON-validation retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 200, body: groqBody("still not json") }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GroqClient({ apiKey: "test-key" });
    await expect(
      client.generateStructured({ prompt: "p", schema, maxRetries: 1 })
    ).rejects.toBeInstanceOf(LLMError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("backs off on a 429 and succeeds on retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({ status: 429, body: {}, headers: { "retry-after": "0" } })
      )
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: groqBody(JSON.stringify({ answer: "ok" })) })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GroqClient({ apiKey: "test-key" });
    const result = await client.generateStructured({ prompt: "p", schema });

    expect(result).toEqual({ answer: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error for a non-429 API failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 500, body: { error: "server error" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GroqClient({ apiKey: "test-key" });
    await expect(client.generateStructured({ prompt: "p", schema })).rejects.toBeInstanceOf(LLMError);
  });

  it("requires an apiKey at construction time", () => {
    expect(() => new GroqClient({ apiKey: "" })).toThrow();
  });
});
