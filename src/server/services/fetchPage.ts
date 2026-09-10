/**
 * Real HTTP fetch used by the crawler and the batch command. Wraps every
 * request with the SSRF guard (lib/security.ts) and the content-type/size
 * restrictions Section 11 requires.
 */

import { assertSafeUrl, UnsafeUrlError } from "../../lib/security";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_CONTENT_BYTES = 2_000_000; // 2MB — Section 11: "restrict handling to expected content types and sizes"
const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];

export interface FetchPageOptions {
  isProduction: boolean;
  userAgent?: string;
}

export function makeFetchPage(opts: FetchPageOptions) {
  return async function fetchPage(
    url: string
  ): Promise<{ status: number; html: string } | null> {
    try {
      await assertSafeUrl(url, { isProduction: opts.isProduction });
    } catch (err) {
      if (err instanceof UnsafeUrlError) return null; // treated as unreachable, not fatal
      throw err;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": opts.userAgent ?? "AIInterviewPrepKitBot/1.0 (+assessment)",
        },
      });

      const contentType = response.headers.get("content-type") ?? "";
      const isAllowedType = ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t));
      if (!isAllowedType) {
        // e.g. a PDF, image, or binary at this URL — skip and report, don't fail the run
        return { status: response.status, html: "" };
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_CONTENT_BYTES) {
        return { status: response.status, html: "" };
      }

      const text = await readWithCap(response, MAX_CONTENT_BYTES);
      return { status: response.status, html: text };
    } catch {
      return null; // timeout, DNS failure, connection refused, etc — caller records as unreachable
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function readWithCap(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return response.text();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return combined.toString("utf-8");
}
