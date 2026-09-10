import { describe, it, expect } from "vitest";
import { buildWeakSpotsReport } from "./weakSpots";
import { Requirement } from "./extractRequirements";
import { Question } from "./generateQuestions";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years Node.js", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentors juniors", kind: "behavioural", priority: "nice" },
  { id: "r3", text: "Distributed systems experience", kind: "technical", priority: "must" },
];

function q(id: string, requirement_ids: string[], difficulty: 1 | 2 | 3): Question {
  return { id, requirement_ids, category: "technical", prompt: "p", answer_outline: "a", difficulty };
}

describe("buildWeakSpotsReport", () => {
  it("ranks an uncovered must-have requirement highest, above anything else", () => {
    const questions = [q("q1", ["r2"], 1), q("q2", ["r1"], 1)];
    // r3 (must) has no question at all
    const flashcards = [{ id: "f1", requirement_ids: ["r2"] }, { id: "f2", requirement_ids: ["r1"] }];
    const progress = { f1: { confidence: "high" as const }, f2: { confidence: "high" as const } };

    const report = buildWeakSpotsReport(requirements, questions, flashcards, progress);
    expect(report[0].requirementId).toBe("r3");
    expect(report[0].reason).toMatch(/no question/);
  });

  it("ranks low-confidence must-have above high-confidence must-have", () => {
    const questions = [q("q1", ["r1"], 2), q("q2", ["r3"], 2)];
    const flashcards = [{ id: "f1", requirement_ids: ["r1"] }, { id: "f2", requirement_ids: ["r3"] }];
    const progress = {
      f1: { confidence: "low" as const },
      f2: { confidence: "high" as const },
    };

    const report = buildWeakSpotsReport(requirements, questions, flashcards, progress, 2);
    const r1Index = report.findIndex((s) => s.requirementId === "r1");
    const r3Index = report.findIndex((s) => s.requirementId === "r3");
    expect(r1Index).toBeLessThan(r3Index);
  });

  it("treats never-practiced as riskier than low confidence", () => {
    const questions = [q("q1", ["r1"], 1), q("q2", ["r3"], 1)];
    const flashcards = [{ id: "f1", requirement_ids: ["r1"] }, { id: "f2", requirement_ids: ["r3"] }];
    const progress = { f1: { confidence: "low" as const } }; // f2 (r3) never practiced

    const report = buildWeakSpotsReport(requirements, questions, flashcards, progress, 3);
    const r1 = report.find((s) => s.requirementId === "r1")!;
    const r3 = report.find((s) => s.requirementId === "r3")!;
    expect(r3.riskScore).toBeGreaterThan(r1.riskScore);
    expect(r3.reason).toMatch(/not practiced/);
  });

  it("ranks must-have above nice-to-have when all else is equal", () => {
    const questions = [q("q1", ["r1"], 2), q("q2", ["r2"], 2)];
    const flashcards = [{ id: "f1", requirement_ids: ["r1"] }, { id: "f2", requirement_ids: ["r2"] }];
    const progress = { f1: { confidence: "medium" as const }, f2: { confidence: "medium" as const } };

    const report = buildWeakSpotsReport(requirements, questions, flashcards, progress, 2);
    const r1Index = report.findIndex((s) => s.requirementId === "r1");
    const r2Index = report.findIndex((s) => s.requirementId === "r2");
    expect(r1Index).toBeLessThan(r2Index);
  });

  it("respects the limit parameter", () => {
    const report = buildWeakSpotsReport(requirements, [], [], {}, 1);
    expect(report).toHaveLength(1);
  });

  it("handles a requirement with no flashcards at all without crashing", () => {
    const questions = [q("q1", ["r1"], 1)];
    const report = buildWeakSpotsReport(requirements, questions, [], {}, 3);
    expect(report.length).toBe(3);
  });
});
