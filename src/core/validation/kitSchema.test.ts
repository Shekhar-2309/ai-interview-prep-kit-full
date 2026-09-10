import { describe, it, expect } from "vitest";
import { validateKit, toAppendixA } from "./kitSchema";

function makeValidKit() {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.example.com",
      role: "Senior Backend Engineer",
      location: "Remote",
      jd_chars: 1200,
      researched_at: "2026-09-10T12:00:00Z",
      pages_used: ["https://acme.example.com/careers"],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "B2B SaaS for widget management.",
      sources: ["https://acme.example.com/about"],
    },
    role: {
      title: "Senior Backend Engineer",
      seniority: "Senior",
      responsibilities: ["Own the payments service"],
      requirements: [
        { id: "r1", text: "5+ years with Node.js", kind: "technical", priority: "must" },
        { id: "r2", text: "Mentors junior engineers", kind: "behavioural", priority: "nice" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Walk me through how you'd design a rate limiter.",
        answer_outline: "Token bucket, sliding window trade-offs.",
        difficulty: 2,
      },
    ],
    flashcards: [
      { id: "f1", front: "What is a token bucket?", back: "A rate-limiting algorithm.", requirement_ids: ["r1"] },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "Core technical review", question_ids: ["q1"], minutes: 60 }],
    },
    coverage: { uncovered_requirement_ids: ["r2"], passes: 1 },
  };
}

describe("validateKit", () => {
  it("accepts a well-formed kit", () => {
    const result = validateKit(makeValidKit());
    expect(result.valid).toBe(true);
  });

  it("rejects a kit missing a required field", () => {
    const kit = makeValidKit();
    // @ts-expect-error deliberately breaking the shape
    delete kit.company_brief;
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
  });

  it("rejects an out-of-range priority enum", () => {
    const kit = makeValidKit();
    kit.role.requirements[0].priority = "optional" as any;
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
  });

  it("rejects a question referencing a nonexistent requirement id", () => {
    const kit = makeValidKit();
    kit.questions[0].requirement_ids = ["r-does-not-exist"];
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("unknown requirement id"))).toBe(true);
    }
  });

  it("rejects a schedule whose day count doesn't match days_available", () => {
    const kit = makeValidKit();
    kit.schedule.days_available = 3;
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("days_available"))).toBe(true);
    }
  });

  it("rejects duplicate requirement ids", () => {
    const kit = makeValidKit();
    kit.role.requirements.push({ id: "r1", text: "duplicate", kind: "technical", priority: "nice" });
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
  });

  it("rejects non-integer minutes/difficulty", () => {
    const kit = makeValidKit();
    kit.questions[0].difficulty = 2.5 as any;
    const result = validateKit(kit);
    expect(result.valid).toBe(false);
  });
});

describe("toAppendixA", () => {
  it("strips builder metadata (origin/locked) before output", () => {
    const kit = makeValidKit() as any;
    kit.questions[0].origin = "edited";
    kit.questions[0].locked = true;

    const stripped = toAppendixA(kit);
    expect((stripped.questions[0] as any).origin).toBeUndefined();
    expect((stripped.questions[0] as any).locked).toBeUndefined();
    expect(stripped.questions[0].id).toBe("q1");
  });
});
