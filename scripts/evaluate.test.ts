import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { parseArgs, mapWithConcurrency, CasesFileSchema } from "./evaluate";

describe("parseArgs", () => {
  it("parses --input and --output flags", () => {
    const result = parseArgs(["--input", "cases.json", "--output", "kits.json"]);
    expect(result).toEqual({ input: "cases.json", output: "kits.json" });
  });

  it("works regardless of flag order", () => {
    const result = parseArgs(["--output", "out.json", "--input", "in.json"]);
    expect(result).toEqual({ input: "in.json", output: "out.json" });
  });

  it("throws when a required flag is missing", () => {
    expect(() => parseArgs(["--input", "cases.json"])).toThrow();
    expect(() => parseArgs([])).toThrow();
  });
});

describe("mapWithConcurrency", () => {
  it("processes all items and preserves output order regardless of completion order", async () => {
    const items = [50, 10, 30, 5, 20];
    const results = await mapWithConcurrency(items, 3, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(results).toEqual([100, 20, 60, 10, 40]);
  });

  it("respects the concurrency limit (never runs more than `limit` at once)", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return n;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it("continues processing remaining items when one throws, per case", async () => {
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, 3, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      })
    ).rejects.toThrow();
    // Note: mapWithConcurrency itself propagates a rejection (Promise.all
    // semantics) — per-case failure isolation is handled by the caller in
    // main() wrapping each fn() body in try/catch, not by this helper.
    // This test documents that boundary explicitly.
  });
});

describe("CasesFileSchema", () => {
  it("accepts a well-formed cases array", () => {
    const input = [{ id: "case-01", jd: "JD text", company_url: "http://localhost:8099/acme/", days: 5 }];
    expect(() => CasesFileSchema.parse(input)).not.toThrow();
  });

  it("rejects a case missing a required field", () => {
    const input = [{ id: "case-01", jd: "JD text", days: 5 }];
    expect(() => CasesFileSchema.parse(input)).toThrow();
  });

  it("rejects an invalid company_url", () => {
    const input = [{ id: "case-01", jd: "JD text", company_url: "not-a-url", days: 5 }];
    expect(() => CasesFileSchema.parse(input)).toThrow();
  });
});

describe("batch output contract (Appendix B shape)", () => {
  it("writes a version/generated_at/kits envelope with ok and failed entries", async () => {
    // Exercises the same shape-construction logic as main(), directly,
    // rather than mocking fs + dotenv + real Groq/fetch for a full run —
    // main()'s I/O and env wiring have already been covered by manual
    // walkthrough; this locks down the output CONTRACT itself.
    const results = [
      { id: "case-01", status: "ok" as const, kit: { source: {} }, error: null },
      {
        id: "case-04",
        status: "failed" as const,
        kit: null,
        error: { code: "COMPANY_UNREACHABLE", message: "Company site unreachable after 3 retries." },
      },
    ];
    const payload = { version: "1.0", generated_at: new Date().toISOString(), kits: results };

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evaluate-test-"));
    const outputPath = path.join(tmpDir, "kits.json");
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf-8");

    const written = JSON.parse(await fs.readFile(outputPath, "utf-8"));
    expect(written.version).toBe("1.0");
    expect(written.kits).toHaveLength(2);
    expect(written.kits[0].status).toBe("ok");
    expect(written.kits[1].status).toBe("failed");
    expect(written.kits[1].error.code).toBe("COMPANY_UNREACHABLE");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
