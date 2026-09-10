import { describe, it, expect, vi } from "vitest";
import dns from "dns/promises";
import { assertSafeUrl, UnsafeUrlError } from "./security";

vi.mock("dns/promises", () => ({
  default: { lookup: vi.fn() },
}));

const mockedLookup = dns.lookup as unknown as ReturnType<typeof vi.fn>;

describe("assertSafeUrl", () => {
  it("allows localhost in non-production", async () => {
    await expect(
      assertSafeUrl("http://localhost:8099/acme", { isProduction: false })
    ).resolves.toBeUndefined();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a loopback address in production", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      assertSafeUrl("http://sneaky.example.com", { isProduction: true })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects a hostname resolving to a private 10.x address in production", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    await expect(
      assertSafeUrl("http://internal.example.com", { isProduction: true })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects a hostname resolving to a 172.16-31.x private address in production", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "172.20.5.5", family: 4 }]);
    await expect(
      assertSafeUrl("http://internal.example.com", { isProduction: true })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("does NOT reject a 172.15.x or 172.32.x address (outside the private /12 range)", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "172.32.5.5", family: 4 }]);
    await expect(
      assertSafeUrl("http://public-ish.example.com", { isProduction: true })
    ).resolves.toBeUndefined();
  });

  it("allows a genuinely public address in production", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      assertSafeUrl("https://example.com", { isProduction: true })
    ).resolves.toBeUndefined();
  });

  it("rejects IPv6 loopback (::1) in production", async () => {
    mockedLookup.mockResolvedValueOnce([{ address: "::1", family: 6 }]);
    await expect(
      assertSafeUrl("http://sneaky6.example.com", { isProduction: true })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects disallowed protocols regardless of environment", async () => {
    await expect(
      assertSafeUrl("file:///etc/passwd", { isProduction: false })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(
      assertSafeUrl("ftp://example.com", { isProduction: true })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects an unresolvable hostname in production", async () => {
    mockedLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(
      assertSafeUrl("http://does-not-exist.invalid", { isProduction: true })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects a malformed URL", async () => {
    await expect(assertSafeUrl("not a url", { isProduction: false })).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
  });
});
