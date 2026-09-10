import { describe, it, expect } from "vitest";
import { hashInput } from "./kitService";

describe("hashInput", () => {
  it("produces the same hash for identical input", () => {
    const a = hashInput("Senior Engineer JD text", "https://acme.example.com", 5);
    const b = hashInput("Senior Engineer JD text", "https://acme.example.com", 5);
    expect(a).toBe(b);
  });

  it("is case-insensitive on the company URL but not on JD text", () => {
    const a = hashInput("JD text", "https://Acme.example.com", 5);
    const b = hashInput("JD text", "https://acme.example.com", 5);
    expect(a).toBe(b);
  });

  it("produces different hashes for different days", () => {
    const a = hashInput("JD text", "https://acme.example.com", 5);
    const b = hashInput("JD text", "https://acme.example.com", 10);
    expect(a).not.toBe(b);
  });

  it("produces different hashes for different job descriptions", () => {
    const a = hashInput("JD one", "https://acme.example.com", 5);
    const b = hashInput("JD two", "https://acme.example.com", 5);
    expect(a).not.toBe(b);
  });

  it("is insensitive to surrounding whitespace", () => {
    const a = hashInput("  JD text  ", "  https://acme.example.com  ", 5);
    const b = hashInput("JD text", "https://acme.example.com", 5);
    expect(a).toBe(b);
  });
});

/**
 * NOTE: startKitGeneration / saveGeneratedKit / getOwnedKit all require a real
 * Mongo connection to test meaningfully (ownership enforcement, the
 * duplicate-run-reuse path, optimistic version incrementing). Recommended:
 * mongodb-memory-server spun up in a vitest setup file, e.g.
 *
 *   import { MongoMemoryServer } from "mongodb-memory-server";
 *   let mongod: MongoMemoryServer;
 *   beforeAll(async () => {
 *     mongod = await MongoMemoryServer.create();
 *     await connectDB(mongod.getUri());
 *   });
 *   afterAll(async () => { await disconnectDB(); await mongod.stop(); });
 *
 * Not wired up in this pass since it needs a package install this sandbox
 * can't reach — add it when you have network access to `npm install
 * mongodb-memory-server --save-dev`.
 */
