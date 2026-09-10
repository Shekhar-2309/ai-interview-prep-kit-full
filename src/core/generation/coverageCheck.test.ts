import { describe, it, expect } from "vitest";
import { checkCoverage } from "./coverageCheck";
import { Requirement } from "./extractRequirements";
import { Question } from "./generateQuestions";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years Node.js", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentors juniors", kind: "behavioural", priority: "nice" },
  { id: "r3", text: "Owns incident response", kind: "technical", priority: "must" },
];

function q(id: string, requirement_ids: string[]): Question {
  return { id, requirement_ids, category: "technical", prompt: "p", answer_outline: "a", difficulty: 2 };
}

describe("checkCoverage", () => {
  it("finds no gaps when every requirement has a question", () => {
    const questions = [q("q1", ["r1"]), q("q2", ["r2"]), q("q3", ["r3"])];
    const result = checkCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toEqual([]);
    expect(result.uncoveredMustHaveIds).toEqual([]);
  });

  it("flags an uncovered must-have requirement", () => {
    const questions = [q("q1", ["r1"]), q("q2", ["r2"])]; // r3 (must) uncovered
    const result = checkCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toContain("r3");
    expect(result.uncoveredMustHaveIds).toEqual(["r3"]);
  });

  it("flags an uncovered nice-to-have without forcing a must-have gap", () => {
    const questions = [q("q1", ["r1"]), q("q2", ["r3"])]; // r2 (nice) uncovered
    const result = checkCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toEqual(["r2"]);
    expect(result.uncoveredMustHaveIds).toEqual([]);
  });

  it("counts a requirement as covered even if only referenced alongside others", () => {
    const questions = [q("q1", ["r1", "r3"])];
    const result = checkCoverage(requirements, questions);
    expect(result.uncoveredMustHaveIds).toEqual([]);
    expect(result.uncoveredRequirementIds).toEqual(["r2"]);
  });

  it("returns every requirement as uncovered when there are no questions", () => {
    const result = checkCoverage(requirements, []);
    expect(result.uncoveredRequirementIds.sort()).toEqual(["r1", "r2", "r3"]);
    expect(result.uncoveredMustHaveIds.sort()).toEqual(["r1", "r3"]);
  });
});
