/**
 * Section 11: "Validate external URLs before fetching them, and reject
 * private and loopback addresses in production."
 *
 * "In production" matters here: Section 9's batch command is explicitly
 * tested against company sites served from a local address, so this guard
 * must NOT block localhost/private IPs in development/test — only in prod.
 */

import dns from "dns/promises";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * Validates a URL is safe to fetch. Throws UnsafeUrlError if not.
 * Resolves the hostname to an IP and checks that IP — not just the
 * hostname string — since "notarealprivatehost.example.com" could still
 * resolve to 127.0.0.1 (DNS rebinding).
 */
export async function assertSafeUrl(
  url: string,
  opts: { isProduction: boolean }
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrlError(`invalid URL: ${url}`);
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new UnsafeUrlError(`disallowed protocol: ${parsed.protocol}`);
  }

  if (!opts.isProduction) {
    return; // batch test fixtures may be served from localhost — see Section 9
  }

  let addresses: string[];
  try {
    const result = await dns.lookup(parsed.hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new UnsafeUrlError(`could not resolve hostname: ${parsed.hostname}`);
  }

  for (const ip of addresses) {
    if (isPrivateOrLoopback(ip)) {
      throw new UnsafeUrlError(
        `refusing to fetch ${url}: resolves to a private/loopback address (${ip})`
      );
    }
  }
}

function isPrivateOrLoopback(ip: string): boolean {
  if (ip.includes(":")) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed -> reject

  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("fe80")) return true; // fe80::/10 link-local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded IPv4 address too
    return isPrivateIPv4(lower.replace("::ffff:", ""));
  }
  return false;
}
