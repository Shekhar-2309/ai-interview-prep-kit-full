/**
 * Builds the day-by-day study schedule from generated questions and the
 * number of days the user has. Pure, deterministic, no LLM call — Section 8
 * is explicit that this is arithmetic, not generation.
 *
 * Algorithm:
 *  1. Weight every question: must-have requirements outrank nice-to-have,
 *     and within that, higher difficulty outranks lower — this is what
 *     "harder and higher-priority material lands earlier" means concretely.
 *  2. Sort questions descending by weight.
 *  3. Split the sorted list into `days` contiguous chunks of roughly equal
 *     size (ceil-based), chunk 1 → day 1. This guarantees the hardest/
 *     highest-priority material clusters on earlier days without requiring
 *     per-day time-budget bin-packing, which would be over-engineering for
 *     what's fundamentally a triage tool, not a scheduling optimizer.
 *  4. Each day's minutes = sum of a fixed per-difficulty time estimate
 *     (difficulty * MINUTES_PER_DIFFICULTY_POINT), always an integer.
 *  5. Day count always equals days_available exactly, even if some trailing
 *     days end up empty (0 minutes) because there simply isn't enough
 *     material — e.g. a thin JD against a 60-day schedule. This is the
 *     honest behavior Section 10 asks for, not padding with busywork.
 */

import { Requirement } from "../generation/extractRequirements";
import { Question } from "../generation/generateQuestions";

const MINUTES_PER_DIFFICULTY_POINT = 20;

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface Schedule {
  days_available: number;
  days: ScheduleDay[];
}

function requirementPriorityMap(requirements: Requirement[]): Map<string, "must" | "nice"> {
  const map = new Map<string, "must" | "nice">();
  for (const r of requirements) map.set(r.id, r.priority);
  return map;
}

function questionWeight(
  q: Question,
  priorityMap: Map<string, "must" | "nice">
): number {
  const hasMust = q.requirement_ids.some((rid) => priorityMap.get(rid) === "must");
  const priorityScore = hasMust ? 100 : 0;
  return priorityScore + q.difficulty * 10;
}

function focusLabel(questions: Question[]): string {
  if (questions.length === 0) return "Review / buffer";
  const counts: Record<string, number> = {};
  for (const q of questions) {
    counts[q.category] = (counts[q.category] ?? 0) + 1;
  }
  const [topCategory] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const labels: Record<string, string> = {
    technical: "Technical deep-dive",
    behavioural: "Behavioural prep",
    "system-design": "System design practice",
    "company-fit": "Company & culture fit",
  };
  return labels[topCategory] ?? "Mixed review";
}

export function buildSchedule(
  requirements: Requirement[],
  questions: Question[],
  daysAvailable: number
): Schedule {
  if (daysAvailable < 1) {
    throw new Error("daysAvailable must be at least 1");
  }

  const priorityMap = requirementPriorityMap(requirements);
  const sorted = [...questions].sort(
    (a, b) => questionWeight(b, priorityMap) - questionWeight(a, priorityMap)
  );

  const days: ScheduleDay[] = [];

  if (sorted.length === 0) {
    // No questions at all (extremely thin JD) — still produce the requested
    // number of days, honestly empty, rather than fabricating content.
    for (let d = 1; d <= daysAvailable; d++) {
      days.push({ day: d, focus: "Review / buffer", question_ids: [], minutes: 0 });
    }
    return { days_available: daysAvailable, days };
  }

  const chunkSize = Math.ceil(sorted.length / daysAvailable);

  for (let d = 1; d <= daysAvailable; d++) {
    const start = (d - 1) * chunkSize;
    const chunk = sorted.slice(start, start + chunkSize);
    const minutes = chunk.reduce((sum, q) => sum + q.difficulty * MINUTES_PER_DIFFICULTY_POINT, 0);
    days.push({
      day: d,
      focus: focusLabel(chunk),
      question_ids: chunk.map((q) => q.id),
      minutes,
    });
  }

  return { days_available: daysAvailable, days };
}
