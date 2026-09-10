import { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { currentUserId } from "../middleware/auth";
import {
  CreateKitRequestSchema,
  BatchCreateKitRequestSchema,
  EditQuestionRequestSchema,
  EditBriefRequestSchema,
  EditFlashcardRequestSchema,
  MoveQuestionRequestSchema,
  ReorderQuestionsRequestSchema,
  AddQuestionRequestSchema,
  AddFlashcardRequestSchema,
  RegenerateSectionRequestSchema,
  PracticeRecordRequestSchema,
} from "../validation/requestSchemas";
import { startKitGeneration, getOwnedKit, listOwnedKits } from "../services/kitService";
import { runGenerationJob } from "../services/generationService";
import { attachSSE } from "../services/sseHub";
import { config } from "../config";
import * as builder from "../services/kitBuilderService";
import { GroqClient } from "../../core/generation/groqClient";
import { buildWeakSpotsReport } from "../../core/generation/weakSpots";
import { Kit } from "../../models/Kit";

export const createKit = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const input = CreateKitRequestSchema.parse(req.body);

  const { kit, run, reusedExisting } = await startKitGeneration({ userId, ...input });

  if (!reusedExisting) {
    // Fire-and-forget — the client streams progress via SSE / polls status.
    runGenerationJob(kit._id.toString(), run._id.toString(), input, {
      groqApiKey: config.groqApiKey,
      isProduction: config.isProduction,
    }).catch((err) => {
      // Should already be caught inside runGenerationJob, but guard against
      // a truly unexpected throw so it doesn't become an unhandled rejection.
      // eslint-disable-next-line no-console
      console.error("unhandled generation job error", err);
    });
  }

  res.status(202).json({
    kitId: kit._id,
    runId: run._id,
    reusedExisting,
  });
});

/** Section 2: batch upload of description-and-company pairs. Kicks off one
 *  generation job per case, sequentially handed to the same pipeline/rate
 *  limiter as single-kit creation — the Groq client's process-wide queue
 *  (see groqClient.ts) is what keeps this from blowing the free tier. */
export const createKitsBatch = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const { cases } = BatchCreateKitRequestSchema.parse(req.body);

  const results = await Promise.all(
    cases.map(async (c) => {
      const { kit, run, reusedExisting } = await startKitGeneration({ userId, ...c });
      if (!reusedExisting) {
        runGenerationJob(kit._id.toString(), run._id.toString(), c, {
          groqApiKey: config.groqApiKey,
          isProduction: config.isProduction,
        }).catch((err) => console.error("unhandled generation job error", err));
      }
      return { kitId: kit._id, runId: run._id, reusedExisting };
    })
  );

  res.status(202).json({ results });
});

export const listKits = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const kits = await listOwnedKits(userId);
  res.json({
    kits: kits.map((k) => ({
      id: k._id,
      status: k.status,
      role: (k.kit as any)?.role?.title ?? null,
      company: (k.kit as any)?.source?.company ?? null,
      createdAt: k.createdAt,
    })),
  });
});

export const getKit = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const kit = await getOwnedKit(req.params.id, userId);
  res.json({
    id: kit._id,
    status: kit.status,
    version: kit.version,
    failureReason: kit.failureReason ?? null,
    kit: kit.kit ?? null,
  });
});

/** SSE progress stream for a given generation run. Ownership is enforced by
 *  first resolving the kit (which checks userId), not the run directly. */
export const streamKitProgress = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const kit = await getOwnedKit(req.params.id, userId);
  const unsubscribe = attachSSE(res, req.params.runId);

  req.on("close", () => {
    unsubscribe();
  });

  // If generation already finished before the client connected (fast/small
  // kit, or a page reload), tell them immediately rather than leaving them
  // hanging on an open connection that will never emit again.
  if (kit.status === "ready") {
    res.write(`event: completed\ndata: ${JSON.stringify({ kitId: kit._id })}\n\n`);
  } else if (kit.status === "failed") {
    res.write(`event: failed\ndata: ${JSON.stringify({ error: kit.failureReason })}\n\n`);
  }
});

// ---------- Builder endpoints ----------
// All take `version` in the body for optimistic concurrency (Section 13:
// "what happens when ... triggered twice for the same posting").

function getVersion(req: Request): number {
  const v = Number(req.body.version);
  if (Number.isNaN(v)) throw new Error("version is required in the request body");
  return v;
}

export const editBrief = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const patch = EditBriefRequestSchema.parse(req.body);
  const doc = await builder.editBrief(req.params.id, getVersion(req), patch);
  res.json({ kit: doc.kit, version: doc.version });
});

export const editQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId); // ownership check
  const patch = EditQuestionRequestSchema.parse(req.body);
  const doc = await builder.editQuestion(req.params.id, getVersion(req), req.params.questionId, patch);
  res.json({ kit: doc.kit, version: doc.version });
});

export const editFlashcard = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const patch = EditFlashcardRequestSchema.parse(req.body);
  const doc = await builder.editFlashcard(req.params.id, getVersion(req), req.params.flashcardId, patch);
  res.json({ kit: doc.kit, version: doc.version });
});

export const moveQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const { category } = MoveQuestionRequestSchema.parse(req.body);
  const doc = await builder.moveQuestionCategory(req.params.id, getVersion(req), req.params.questionId, category);
  res.json({ kit: doc.kit, version: doc.version });
});

export const reorderQuestions = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const { orderedIds } = ReorderQuestionsRequestSchema.parse(req.body);
  const category = req.params.category as any;
  const doc = await builder.reorderQuestions(req.params.id, getVersion(req), category, orderedIds);
  res.json({ kit: doc.kit, version: doc.version });
});

export const addQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const input = AddQuestionRequestSchema.parse(req.body);
  const doc = await builder.addQuestion(req.params.id, getVersion(req), input);
  res.status(201).json({ kit: doc.kit, version: doc.version });
});

export const deleteQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const doc = await builder.deleteQuestion(req.params.id, getVersion(req), req.params.questionId);
  res.json({ kit: doc.kit, version: doc.version });
});

export const addFlashcard = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const input = AddFlashcardRequestSchema.parse(req.body);
  const doc = await builder.addFlashcard(req.params.id, getVersion(req), input);
  res.status(201).json({ kit: doc.kit, version: doc.version });
});

export const deleteFlashcard = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  await getOwnedKit(req.params.id, userId);
  const doc = await builder.deleteFlashcard(req.params.id, getVersion(req), req.params.flashcardId);
  res.json({ kit: doc.kit, version: doc.version });
});

export const regenerateSection = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const kitDoc = await getOwnedKit(req.params.id, userId);
  const { section, category, force } = RegenerateSectionRequestSchema.parse(req.body);
  const llm = new GroqClient({ apiKey: config.groqApiKey });

  if (section === "questions") {
    if (!category) throw new Error("category is required when regenerating questions");
    const doc = await builder.regenerateQuestionCategory(req.params.id, getVersion(req), category, llm);
    res.json({ kit: doc.kit, version: doc.version });
    return;
  }

  if (section === "schedule") {
    const doc = await builder.regenerateSchedule(req.params.id, getVersion(req));
    res.json({ kit: doc.kit, version: doc.version });
    return;
  }

  // company_brief — reuse the pages already recorded on source.pages_used at
  // generation time is not retained as full text, so a true re-crawl would
  // be needed for a from-scratch regeneration. For this pass we regenerate
  // from the brief's existing sources list as a lightweight refresh; a
  // fuller implementation would re-invoke crawlAndRank here.
  const existingKit = kitDoc.kit as any;
  const pseudoPages = (existingKit?.company_brief?.sources ?? []).map((url: string) => ({
    url,
    urlScore: 0,
    contentScore: 0,
    totalScore: 0,
    kind: "about" as const,
    title: "",
    textExcerpt: existingKit.company_brief.summary ?? "",
  }));
  const doc = await builder.regenerateBrief(req.params.id, getVersion(req), llm, pseudoPages, force);
  res.json({ kit: doc.kit, version: doc.version });
});

// ---------- Practice mode ----------

/** Section "Creativity Requirement": Weak Spots Report — combines coverage
 *  gaps and practice confidence into one ranked "review this first" list. */
export const getWeakSpots = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const kit = await getOwnedKit(req.params.id, userId);
  const kitData = kit.kit as any;
  if (!kitData) {
    res.json({ weakSpots: [] });
    return;
  }

  const progress = Object.fromEntries(kit.practiceProgress) as Record<
    string,
    { confidence: "low" | "medium" | "high" }
  >;
  const weakSpots = buildWeakSpotsReport(
    kitData.role.requirements,
    kitData.questions,
    kitData.flashcards,
    progress
  );
  res.json({ weakSpots });
});

export const recordPracticeConfidence = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const kit = await getOwnedKit(req.params.id, userId);
  const { flashcardId, confidence } = PracticeRecordRequestSchema.parse(req.body);

  kit.practiceProgress.set(flashcardId, { confidence, updated_at: new Date().toISOString() });
  await kit.save();

  res.json({ practiceProgress: Object.fromEntries(kit.practiceProgress) });
});

/** Section 7: "order the next session by what they were least confident
 *  about." Cards never reviewed sort first (treated as lowest confidence),
 *  then low, then medium, then high. */
const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export const getPracticeSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req);
  const kit = await getOwnedKit(req.params.id, userId);
  const flashcards = ((kit.kit as any)?.flashcards ?? []) as { id: string }[];

  const ordered = [...flashcards].sort((a, b) => {
    const rankA = kit.practiceProgress.get(a.id)?.confidence;
    const rankB = kit.practiceProgress.get(b.id)?.confidence;
    const scoreA = rankA ? CONFIDENCE_RANK[rankA] : -1; // never-reviewed sorts first
    const scoreB = rankB ? CONFIDENCE_RANK[rankB] : -1;
    return scoreA - scoreB;
  });

  res.json({
    orderedFlashcardIds: ordered.map((f) => f.id),
    progress: Object.fromEntries(kit.practiceProgress),
    covered: [...kit.practiceProgress.keys()],
    totalCount: flashcards.length,
  });
});
