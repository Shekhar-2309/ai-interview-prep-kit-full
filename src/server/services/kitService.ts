import crypto from "crypto";
import { Types } from "mongoose";
import { Kit, KitDoc } from "../../models/Kit";
import { GenerationRun, GenerationRunDoc } from "../../models/GenerationRun";
import { Kit as ValidatedKit } from "../../core/validation/kitSchema";
import { markGenerated } from "../../core/builder/kitState";

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  constructor(message: string, public readonly existingKitId?: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Section 10: "the same description and company are submitted twice." */
export function hashInput(jd: string, companyUrl: string, days: number): string {
  return crypto
    .createHash("sha256")
    .update(`${jd.trim()}\u0000${companyUrl.trim().toLowerCase()}\u0000${days}`)
    .digest("hex");
}

/**
 * Creates the placeholder Kit record before generation starts, and the
 * GenerationRun that tracks its progress. If an identical, still-in-flight
 * run already exists for this user+input, returns that instead of starting
 * a duplicate — this IS the answer to "triggered twice for the same
 * posting": the second request joins the first run rather than racing it.
 */
export async function startKitGeneration(params: {
  userId: string;
  jd: string;
  companyUrl: string;
  days: number;
}): Promise<{ kit: KitDoc; run: GenerationRunDoc; reusedExisting: boolean }> {
  const inputHash = hashInput(params.jd, params.companyUrl, params.days);

  const existingKit = await Kit.findOne({
    userId: params.userId,
    inputHash,
    status: "generating",
  });

  if (existingKit) {
    const existingRun = await GenerationRun.findOne({
      kitId: existingKit._id,
      status: { $in: ["pending", "running"] },
    }).sort({ createdAt: -1 });

    if (existingRun) {
      return { kit: existingKit, run: existingRun, reusedExisting: true };
    }
  }

  const kit = await Kit.create({
    userId: params.userId,
    inputHash,
    inputJd: params.jd,
    inputCompanyUrl: params.companyUrl,
    inputDays: params.days,
    status: "generating",
    version: 0,
  });

  const run = await GenerationRun.create({
    kitId: kit._id,
    userId: params.userId,
    status: "pending",
  });

  return { kit, run, reusedExisting: false };
}

export async function markRunStep(runId: string, step: string): Promise<void> {
  await GenerationRun.findByIdAndUpdate(runId, { status: "running", currentStep: step });
}

export async function markRunFailed(runId: string, kitId: string, error: string): Promise<void> {
  await Promise.all([
    GenerationRun.findByIdAndUpdate(runId, { status: "failed", error }),
    Kit.findByIdAndUpdate(kitId, { status: "failed", failureReason: error }),
  ]);
}

/**
 * Persists a freshly generated kit, wrapping every item with builder metadata
 * (origin: "generated", locked: false) — see core/builder/kitState.ts. This
 * is the ONLY place a kit transitions from "generating" to "ready".
 */
export async function saveGeneratedKit(
  kitId: string,
  runId: string,
  generated: ValidatedKit
): Promise<KitDoc> {
  const now = new Date().toISOString();
  const meta = { origin: "generated" as const, locked: false, updated_at: now };

  const kitWithMeta = {
    source: generated.source,
    company_brief: { ...generated.company_brief, _meta: meta },
    role: generated.role,
    questions: generated.questions.map((q) => ({ ...q, _meta: meta })),
    flashcards: generated.flashcards.map((f) => ({ ...f, _meta: meta })),
    schedule: { ...generated.schedule, _meta: meta },
    coverage: generated.coverage,
  };

  const kit = await Kit.findByIdAndUpdate(
    kitId,
    { status: "ready", kit: kitWithMeta, $inc: { version: 1 } },
    { new: true }
  );
  if (!kit) throw new NotFoundError(`kit ${kitId} not found`);

  await GenerationRun.findByIdAndUpdate(runId, { status: "completed", currentStep: null });
  return kit;
}

/** Fetches a kit and enforces ownership — Section 1: "users can read and modify only their own kits." */
export async function getOwnedKit(kitId: string, userId: string): Promise<KitDoc> {
  if (!Types.ObjectId.isValid(kitId)) throw new NotFoundError();
  const kit = await Kit.findById(kitId);
  if (!kit) throw new NotFoundError(`kit ${kitId} not found`);
  if (kit.userId.toString() !== userId) {
    // 404 rather than 403 for a kit belonging to someone else — don't confirm
    // to an unauthorized caller that the id exists at all.
    throw new NotFoundError(`kit ${kitId} not found`);
  }
  return kit;
}

export async function listOwnedKits(userId: string): Promise<KitDoc[]> {
  return Kit.find({ userId }).sort({ createdAt: -1 });
}
