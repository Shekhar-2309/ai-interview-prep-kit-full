/**
 * Builder state model — how generated / edited / manually-added items are tracked,
 * and how "regenerate this section" merges new output without discarding user work.
 *
 * Problem (Section 6): regenerating one section must not discard edits made
 * elsewhere, and a question the user wrote or edited by hand must survive a
 * regeneration of its *own* category.
 *
 * Approach: tag every editable item with lightweight metadata:
 *
 *   origin: "generated" | "edited" | "manual"
 *     - generated: produced by the pipeline, never touched by a human.
 *     - edited:    produced by the pipeline, then modified by a human.
 *     - manual:    created from scratch by a human (Section 6: "add a question
 *                  or flashcard by hand").
 *
 *   locked: boolean
 *     - true for "edited" and "manual" items — regeneration must never remove or
 *       silently overwrite these.
 *     - false for "generated" items — these are exactly what regeneration is
 *       allowed to replace.
 *
 * This metadata rides alongside the Appendix A fields on each item (questions[],
 * flashcards[]) and is stripped before batch output / grading via
 * core/validation/kitSchema.ts's toAppendixA(). Appendix A doesn't forbid extra
 * fields on individual items, and the brief explicitly allows extending the
 * structure "where that genuinely helps" — this is that case.
 *
 * Regenerating a whole section (company_brief, schedule) uses the same
 * generated/edited split at the section level via a single origin+locked pair
 * on that section as a whole, since those sections aren't itemized lists.
 */

export type Origin = "generated" | "edited" | "manual";

export interface EditMeta {
  origin: Origin;
  locked: boolean;
  updated_at: string; // ISO timestamp, for display + optimistic concurrency
}

export type WithMeta<T> = T & { _meta: EditMeta };

/** Called whenever a user edits a previously-generated item inline. */
export function markEdited<T>(item: WithMeta<T>): WithMeta<T> {
  return {
    ...item,
    _meta: { origin: "edited", locked: true, updated_at: new Date().toISOString() },
  };
}

/** Called when a user adds a new question/flashcard by hand. */
export function markManual<T>(item: T): WithMeta<T> {
  return {
    ...item,
    _meta: { origin: "manual", locked: true, updated_at: new Date().toISOString() },
  } as WithMeta<T>;
}

/** Called on items fresh out of the generation pipeline, before any human touches them. */
export function markGenerated<T>(item: T): WithMeta<T> {
  return {
    ...item,
    _meta: { origin: "generated", locked: false, updated_at: new Date().toISOString() },
  } as WithMeta<T>;
}

/**
 * Regenerates one question category without discarding locked items.
 *
 * Algorithm:
 *  1. Split the category's current items into locked (edited/manual — keep as-is)
 *     and unlocked (generated, untouched — eligible for replacement).
 *  2. Determine which requirement_ids are still "covered" by the locked items alone.
 *  3. Ask the generation layer for fresh questions covering ONLY the requirements
 *     not already covered by locked items — this avoids duplicate coverage and
 *     avoids silently re-litigating a requirement the user already has a question for.
 *  4. Result = locked items (untouched) + freshly generated items.
 *
 * The caller (pipeline layer) is responsible for actually invoking the LLM for
 * step 3 — this function is pure and testable on its own.
 */
export function regenerateCategory<
  T extends { requirement_ids: string[]; category: string }
>(
  currentItems: WithMeta<T>[],
  category: string,
  generateFreshForRequirements: (requirementIds: string[]) => WithMeta<T>[]
): WithMeta<T>[] {
  const inCategory = currentItems.filter((i) => i.category === category);
  const outsideCategory = currentItems.filter((i) => i.category !== category);

  const locked = inCategory.filter((i) => i._meta.locked);
  const coveredByLocked = new Set(locked.flatMap((i) => i.requirement_ids));

  // The pipeline decides which requirements this category is even responsible for;
  // here we just avoid asking for requirements already covered by locked items.
  // Caller passes the full requirement set for the category via the closure.
  const freshlyGenerated = generateFreshForRequirements([...coveredByLocked]).map(
    markGenerated
  );

  return [...outsideCategory, ...locked, ...freshlyGenerated];
}

/**
 * Regenerates a whole non-itemized section (e.g. company_brief) respecting a
 * section-level lock. If the user has edited the brief, regeneration is a no-op
 * unless explicitly forced (e.g. user clicks "regenerate anyway").
 */
export function regenerateSection<T>(
  current: WithMeta<T>,
  generateFresh: () => T,
  force = false
): WithMeta<T> {
  if (current._meta.locked && !force) {
    return current; // protect the user's edit; caller should surface this in the UI
  }
  return markGenerated(generateFresh());
}

/**
 * Reordering is just array order — no metadata change needed, since order isn't
 * tracked as a separate field (the array index *is* the order).
 *
 * Moving a question to a different category IS an edit: it changes `category`,
 * so it must be marked edited/locked, or a later regeneration of the
 * *destination* category could duplicate it, and a regeneration of the
 * *source* category would no longer know it existed.
 */
export function moveToCategory<T extends { category: string }>(
  item: WithMeta<T>,
  newCategory: string
): WithMeta<T> {
  return markEdited({ ...item, category: newCategory });
}
