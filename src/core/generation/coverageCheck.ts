/**
 * Coverage check: compares generated questions against extracted requirements
 * to find gaps. Section 3 is explicit that this is "your code's decision to
 * make, not the model's" — deliberately a pure function with no LLM call.
 */

import { Requirement } from "./extractRequirements";
import { Question } from "./generateQuestions";

export interface CoverageResult {
  /** Every requirement id (must or nice) with zero questions referencing it. */
  uncoveredRequirementIds: string[];
  /** Subset of the above that are priority "must" — this is what forces another pass. */
  uncoveredMustHaveIds: string[];
}

export function checkCoverage(
  requirements: Requirement[],
  questions: Question[]
): CoverageResult {
  const coveredIds = new Set<string>();
  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      coveredIds.add(rid);
    }
  }

  const uncoveredRequirementIds = requirements
    .filter((r) => !coveredIds.has(r.id))
    .map((r) => r.id);

  const uncoveredMustHaveIds = requirements
    .filter((r) => r.priority === "must" && !coveredIds.has(r.id))
    .map((r) => r.id);

  return { uncoveredRequirementIds, uncoveredMustHaveIds };
}
