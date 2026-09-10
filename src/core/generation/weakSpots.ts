/**
 * Weak Spots Report — the optional creative feature.
 *
 * The problem it solves: a finished kit has a brief, a question bank, and a
 * schedule, but none of those answer the question a candidate actually asks
 * the night before — "if I only have twenty minutes left, what should I
 * look at?" This report answers exactly that, by combining two things the
 * app already computes separately:
 *
 *   1. Coverage (core/generation/coverageCheck.ts) — is this requirement
 *      backed by a question at all?
 *   2. Practice confidence (Kit.practiceProgress, Section 7) — did the
 *      candidate feel shaky on the flashcards tied to this requirement?
 *
 * Deliberately deterministic, no LLM call — same reasoning as
 * coverageCheck.ts and buildSchedule.ts: ranking existing data by a formula
 * doesn't need generation, and keeping it out of the LLM budget means it's
 * instant and free to recompute every time the candidate opens the report.
 */

import { Requirement } from "./extractRequirements";
import { Question } from "./generateQuestions";

export type Confidence = "low" | "medium" | "high";

export interface WeakSpot {
  requirementId: string;
  requirementText: string;
  priority: "must" | "nice";
  reason: string;
  riskScore: number;
}

const CONFIDENCE_SCORE: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const UNPRACTICED_SCORE = -1; // worse than "low" — never having looked at it is its own risk

export function buildWeakSpotsReport(
  requirements: Requirement[],
  questions: Question[],
  flashcards: { id: string; requirement_ids: string[] }[],
  practiceProgress: Record<string, { confidence: Confidence }>,
  limit = 10
): WeakSpot[] {
  const spots: WeakSpot[] = requirements.map((req) => {
    const relatedQuestions = questions.filter((q) => q.requirement_ids.includes(req.id));
    const relatedFlashcardIds = flashcards
      .filter((f) => f.requirement_ids.includes(req.id))
      .map((f) => f.id);

    const isUncovered = relatedQuestions.length === 0;
    const avgDifficulty =
      relatedQuestions.length > 0
        ? relatedQuestions.reduce((sum, q) => sum + q.difficulty, 0) / relatedQuestions.length
        : 0;

    const confidenceScores = relatedFlashcardIds.map((id) =>
      practiceProgress[id] ? CONFIDENCE_SCORE[practiceProgress[id].confidence] : UNPRACTICED_SCORE
    );
    const avgConfidence =
      confidenceScores.length > 0
        ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
        : UNPRACTICED_SCORE;

    const priorityWeight = req.priority === "must" ? 20 : 8;
    const uncoveredPenalty = isUncovered ? 100 : 0;
    // Lower confidence -> higher risk. Invert onto a positive scale (max
    // possible confidence score is 2, so 2 - avgConfidence ranges 0..3).
    const confidenceRisk = (2 - avgConfidence) * 6;
    const difficultyRisk = avgDifficulty * 3;

    const riskScore = priorityWeight + uncoveredPenalty + confidenceRisk + difficultyRisk;

    return {
      requirementId: req.id,
      requirementText: req.text,
      priority: req.priority,
      reason: describeReason(req.priority, isUncovered, avgConfidence, avgDifficulty),
      riskScore: Math.round(riskScore * 10) / 10,
    };
  });

  return spots.sort((a, b) => b.riskScore - a.riskScore).slice(0, limit);
}

function describeReason(
  priority: "must" | "nice",
  isUncovered: boolean,
  avgConfidence: number,
  avgDifficulty: number
): string {
  const priorityLabel = priority === "must" ? "Must-have" : "Nice-to-have";

  if (isUncovered) {
    return `${priorityLabel}, no question written for it yet`;
  }
  if (avgConfidence === UNPRACTICED_SCORE) {
    return `${priorityLabel}, not practiced yet`;
  }
  if (avgConfidence < 1) {
    return `${priorityLabel}, low confidence last time you practiced it`;
  }
  if (avgDifficulty >= 2.5) {
    return `${priorityLabel}, high-difficulty material`;
  }
  return `${priorityLabel}, holding up fine so far`;
}
