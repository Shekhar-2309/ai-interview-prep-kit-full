import { describe, it, expect } from "vitest";
import { buildSchedule } from "./buildSchedule";
import { Requirement } from "../generation/extractRequirements";
import { Question } from "../generation/generateQuestions";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years Node.js", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentors juniors", kind: "behavioural", priority: "nice" },
];

function q(id: string, requirement_ids: string[], difficulty: 1 | 2 | 3, category: Question["category"] = "technical"): Question {
  return { id, requirement_ids, category, prompt: "p", answer_outline: "a", difficulty };
}

describe("buildSchedule", () => {
  it("produces exactly the number of days requested", () => {
    const questions = [q("q1", ["r1"], 3), q("q2", ["r2"], 1)];
    const schedule = buildSchedule(requirements, questions, 5);
    expect(schedule.days).toHaveLength(5);
    expect(schedule.days_available).toBe(5);
  });

  it("gives every day an integer minutes value", () => {
    const questions = [q("q1", ["r1"], 3), q("q2", ["r2"], 2), q("q3", ["r1"], 1)];
    const schedule = buildSchedule(requirements, questions, 3);
    for (const day of schedule.days) {
      expect(Number.isInteger(day.minutes)).toBe(true);
    }
  });

  it("places every must-have requirement's question somewhere in the schedule", () => {
    const questions = [q("q1", ["r1"], 2), q("q2", ["r2"], 1)];
    const schedule = buildSchedule(requirements, questions, 4);
    const allQuestionIds = schedule.days.flatMap((d) => d.question_ids);
    expect(allQuestionIds).toContain("q1"); // covers must-have r1
  });

  it("front-loads higher-weight (must-have, harder) questions onto earlier days", () => {
    const hard = q("hard", ["r1"], 3); // must-have, difficulty 3 -> highest weight
    const easy = q("easy", ["r2"], 1); // nice-to-have, difficulty 1 -> lowest weight
    const schedule = buildSchedule(requirements, [easy, hard], 2);
    const day1Ids = schedule.days[0].question_ids;
    const day2Ids = schedule.days[1].question_ids;
    expect(day1Ids).toContain("hard");
    expect(day2Ids).toContain("easy");
  });

  it("handles a 1-day schedule by putting everything on day 1", () => {
    const questions = [q("q1", ["r1"], 3), q("q2", ["r2"], 2)];
    const schedule = buildSchedule(requirements, questions, 1);
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].question_ids.sort()).toEqual(["q1", "q2"]);
  });

  it("handles a 60-day schedule with few questions by leaving trailing days honestly empty", () => {
    const questions = [q("q1", ["r1"], 2)];
    const schedule = buildSchedule(requirements, questions, 60);
    expect(schedule.days).toHaveLength(60);
    const nonEmptyDays = schedule.days.filter((d) => d.question_ids.length > 0);
    expect(nonEmptyDays.length).toBeLessThan(60);
    const emptyDay = schedule.days.find((d) => d.question_ids.length === 0);
    expect(emptyDay?.minutes).toBe(0);
  });

  it("handles zero questions without throwing, producing an honest empty schedule", () => {
    const schedule = buildSchedule(requirements, [], 5);
    expect(schedule.days).toHaveLength(5);
    expect(schedule.days.every((d) => d.minutes === 0)).toBe(true);
  });

  it("throws on an invalid days value", () => {
    expect(() => buildSchedule(requirements, [], 0)).toThrow();
  });
});
