import { Kit, KitDoc } from "../../models/Kit";
import { validateKit } from "../../core/validation/kitSchema";
import {
  markEdited,
  markManual,
  markGenerated,
  moveToCategory,
  WithMeta,
} from "../../core/builder/kitState";
import { NotFoundError } from "./kitService";
import { generateQuestionsForCategory, Question, QuestionCategory } from "../../core/generation/generateQuestions";
import { generateBrief } from "../../core/generation/generateBrief";
import { buildSchedule } from "../../core/scheduling/buildSchedule";
import { LLMClient } from "../../core/generation/llmClient";

export class VersionConflictError extends Error {
  constructor() {
    super("kit was modified by another request — reload and retry");
    this.name = "VersionConflictError";
  }
}

/**
 * Loads the raw kit, applies a mutation, re-validates, and persists with an
 * optimistic version bump. Every synchronous builder endpoint funnels
 * through this so "validate before saving" (Section 13) and "increment
 * version" happen exactly once, consistently.
 */
async function withKitMutation(
  kitId: string,
  expectedVersion: number,
  mutate: (kitData: any) => any
): Promise<KitDoc> {
  const doc = await Kit.findById(kitId);
  if (!doc) throw new NotFoundError(`kit ${kitId} not found`);
  if (doc.version !== expectedVersion) throw new VersionConflictError();

  const plain = (doc.kit as any)?.toObject ? (doc.kit as any).toObject() : doc.kit;
  const mutated = mutate(plain);

  const validation = validateKit(mutated);
  if (!validation.valid) {
    throw new Error(`edit produced an invalid kit: ${validation.errors.join("; ")}`);
  }

  doc.kit = mutated as any;
  doc.version += 1;
  await doc.save();
  return doc;
}

export async function editQuestion(
  kitId: string,
  expectedVersion: number,
  questionId: string,
  patch: { prompt?: string; answer_outline?: string; difficulty?: 1 | 2 | 3 }
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    kit.questions = kit.questions.map((q: WithMeta<Question>) =>
      q.id === questionId ? markEdited({ ...q, ...patch }) : q
    );
    return kit;
  });
}

export async function editFlashcard(
  kitId: string,
  expectedVersion: number,
  flashcardId: string,
  patch: { front?: string; back?: string }
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    kit.flashcards = kit.flashcards.map((f: any) =>
      f.id === flashcardId ? markEdited({ ...f, ...patch }) : f
    );
    return kit;
  });
}

export async function moveQuestionCategory(
  kitId: string,
  expectedVersion: number,
  questionId: string,
  newCategory: QuestionCategory
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    kit.questions = kit.questions.map((q: WithMeta<Question>) =>
      q.id === questionId ? moveToCategory(q, newCategory) : q
    );
    return kit;
  });
}

/** Reorder is pure array-order change within one category — no _meta change,
 *  per kitState.ts's design note that order is the array index, not a field. */
export async function reorderQuestions(
  kitId: string,
  expectedVersion: number,
  category: QuestionCategory,
  orderedIds: string[]
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    const inCategory = kit.questions.filter((q: Question) => q.category === category);
    const outsideCategory = kit.questions.filter((q: Question) => q.category !== category);
    const byId = new Map(inCategory.map((q: Question) => [q.id, q]));

    if (orderedIds.length !== inCategory.length || !orderedIds.every((id) => byId.has(id))) {
      throw new Error("orderedIds must be exactly the current question ids for this category");
    }

    const reordered = orderedIds.map((id) => byId.get(id));
    kit.questions = [...outsideCategory, ...reordered];
    return kit;
  });
}

export async function addQuestion(
  kitId: string,
  expectedVersion: number,
  input: {
    category: QuestionCategory;
    requirement_ids: string[];
    prompt: string;
    answer_outline: string;
    difficulty: 1 | 2 | 3;
  }
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    const newId = `manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newQuestion = markManual({ id: newId, ...input });
    kit.questions = [...kit.questions, newQuestion];
    return kit;
  });
}

export async function deleteQuestion(
  kitId: string,
  expectedVersion: number,
  questionId: string
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    kit.questions = kit.questions.filter((q: Question) => q.id !== questionId);
    return kit;
  });
}

export async function addFlashcard(
  kitId: string,
  expectedVersion: number,
  input: { front: string; back: string; requirement_ids: string[] }
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    const newId = `manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newFlashcard = markManual({ id: newId, ...input });
    kit.flashcards = [...kit.flashcards, newFlashcard];
    return kit;
  });
}

export async function deleteFlashcard(
  kitId: string,
  expectedVersion: number,
  flashcardId: string
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    kit.flashcards = kit.flashcards.filter((f: any) => f.id !== flashcardId);
    return kit;
  });
}

function requirementApplies(category: QuestionCategory, kind: string): boolean {
  if (category === "technical" || category === "system-design") {
    return kind === "technical" || kind === "domain";
  }
  if (category === "behavioural") return kind === "behavioural";
  return true; // company-fit isn't tied to requirement kind
}

/**
 * Regenerates one question category via the pipeline's per-category
 * generator, respecting locked (edited/manual) items — the endpoint that
 * proves Section 6's core guarantee end to end, not just in the pure
 * kitState.ts unit tests.
 *
 * Note: this reimplements the lock-respecting split from
 * core/builder/kitState.ts's regenerateCategory() rather than calling it
 * directly, because that helper's callback is synchronous and question
 * generation requires an LLM call. Known follow-up: promote
 * regenerateCategory to accept an async callback so this doesn't diverge
 * from the reference implementation exercised by kitState.test.ts.
 */
export async function regenerateQuestionCategory(
  kitId: string,
  expectedVersion: number,
  category: QuestionCategory,
  llm: LLMClient
): Promise<KitDoc> {
  const doc = await Kit.findById(kitId);
  if (!doc) throw new NotFoundError(`kit ${kitId} not found`);
  if (doc.version !== expectedVersion) throw new VersionConflictError();

  const plain = (doc.kit as any)?.toObject ? (doc.kit as any).toObject() : doc.kit;
  const requirementsById = new Map(plain.role.requirements.map((r: any) => [r.id, r]));

  const inCategory = plain.questions.filter((q: any) => q.category === category);
  const outsideCategory = plain.questions.filter((q: any) => q.category !== category);
  const locked = inCategory.filter((q: any) => q._meta.locked);
  const coveredByLocked = new Set(locked.flatMap((q: any) => q.requirement_ids));

  const uncoveredRequirements = [...requirementsById.values()].filter(
    (r: any) => !coveredByLocked.has(r.id) && requirementApplies(category, r.kind)
  );

  const fresh = await generateQuestionsForCategory(
    { category, requirements: uncoveredRequirements as any, idPrefix: `re-${Date.now()}-` },
    llm
  );

  const merged = [...outsideCategory, ...locked, ...fresh.map((q) => markGenerated(q))];
  const freshSchedule = buildSchedule(plain.role.requirements, merged, plain.schedule.days_available);
  const mutated = { ...plain, questions: merged ,schedule: markGenerated(freshSchedule) };

  const validation = validateKit(mutated);
  if (!validation.valid) {
    throw new Error(`regeneration produced an invalid kit: ${validation.errors.join("; ")}`);
  }

  doc.kit = mutated as any;
  doc.version += 1;
  await doc.save();
  return doc;
}

export async function editBrief(
  kitId: string,
  expectedVersion: number,
  patch: { summary?: string; what_they_do?: string }
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    kit.company_brief = markEdited({ ...kit.company_brief, ...patch });
    return kit;
  });
}

export async function regenerateBrief(
  kitId: string,
  expectedVersion: number,
  llm: LLMClient,
  pages: Parameters<typeof generateBrief>[0],
  force: boolean
): Promise<KitDoc> {
  const doc = await Kit.findById(kitId);
  if (!doc) throw new NotFoundError(`kit ${kitId} not found`);
  if (doc.version !== expectedVersion) throw new VersionConflictError();

  const plain = (doc.kit as any)?.toObject ? (doc.kit as any).toObject() : doc.kit;
  const currentBrief = plain.company_brief as WithMeta<any>;

  if (currentBrief._meta.locked && !force) {
    return doc; // no-op — caller should surface "this was edited, force to override" in the UI
  }

  const fresh = await generateBrief(pages, llm);
  const updatedBrief = markGenerated(fresh);
  const mutated = { ...plain, company_brief: updatedBrief };

  const validation = validateKit(mutated);
  if (!validation.valid) {
    throw new Error(`brief regeneration produced an invalid kit: ${validation.errors.join("; ")}`);
  }

  doc.kit = mutated as any;
  doc.version += 1;
  await doc.save();
  return doc;
}

export async function regenerateSchedule(
  kitId: string,
  expectedVersion: number,
  daysOverride?: number
): Promise<KitDoc> {
  return withKitMutation(kitId, expectedVersion, (kit) => {
    const days = daysOverride ?? kit.schedule.days_available;
    const fresh = buildSchedule(kit.role.requirements, kit.questions, days);
    kit.schedule = markGenerated(fresh);
    return kit;
  });
}
