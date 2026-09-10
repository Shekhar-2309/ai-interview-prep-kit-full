import { Schema, model, Document, Types } from "mongoose";

/**
 * _meta mirrors core/builder/kitState.ts's EditMeta. Stored inline on each
 * question/flashcard so "did the user touch this" survives a reload, not
 * just an in-memory session. company_brief and schedule get a single _meta
 * each (section-level lock) since they aren't itemized lists.
 */
const EditMetaSchema = new Schema(
  {
    origin: { type: String, enum: ["generated", "edited", "manual"], required: true },
    locked: { type: Boolean, required: true },
    updated_at: { type: String, required: true },
  },
  { _id: false }
);

const RequirementSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    kind: { type: String, enum: ["technical", "behavioural", "domain"], required: true },
    priority: { type: String, enum: ["must", "nice"], required: true },
  },
  { _id: false }
);

const QuestionSchema = new Schema(
  {
    id: { type: String, required: true },
    requirement_ids: { type: [String], default: [] },
    category: {
      type: String,
      enum: ["technical", "behavioural", "system-design", "company-fit"],
      required: true,
    },
    prompt: { type: String, required: true },
    answer_outline: { type: String, default: "" },
    difficulty: { type: Number, min: 1, max: 3, required: true },
    _meta: { type: EditMetaSchema, required: true },
  },
  { _id: false }
);

const FlashcardSchema = new Schema(
  {
    id: { type: String, required: true },
    front: { type: String, required: true },
    back: { type: String, required: true },
    requirement_ids: { type: [String], default: [] },
    _meta: { type: EditMetaSchema, required: true },
  },
  { _id: false }
);

const ScheduleDaySchema = new Schema(
  {
    day: { type: Number, required: true },
    focus: { type: String, default: "" },
    question_ids: { type: [String], default: [] },
    minutes: { type: Number, required: true },
  },
  { _id: false }
);

const KitDataSchema = new Schema(
  {
    source: {
      company: String,
      company_url: String,
      role: String,
      location: String,
      jd_chars: Number,
      researched_at: String,
      pages_used: [String],
    },
    company_brief: {
      summary: { type: String, default: "" },
      what_they_do: { type: String, default: "" },
      sources: { type: [String], default: [] },
      _meta: { type: EditMetaSchema, required: true },
    },
    role: {
      title: String,
      seniority: String,
      responsibilities: [String],
      requirements: { type: [RequirementSchema], default: [] },
    },
    questions: { type: [QuestionSchema], default: [] },
    flashcards: { type: [FlashcardSchema], default: [] },
    schedule: {
      days_available: Number,
      days: { type: [ScheduleDaySchema], default: [] },
      _meta: { type: EditMetaSchema, required: true },
    },
    coverage: {
      uncovered_requirement_ids: { type: [String], default: [] },
      passes: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

export type KitStatus = "generating" | "ready" | "failed";

export interface KitDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  inputHash: string;
  inputJd: string;
  inputCompanyUrl: string;
  inputDays: number;
  status: KitStatus;
  failureReason?: string;
  version: number; // optimistic concurrency — see server/services/kitService.ts
  kit?: unknown; // validated against core/validation/kitSchema.ts before save
  /** Section 7 (Practice Mode): confidence per flashcard, keyed by flashcard id.
   *  Deliberately kept OUTSIDE the `kit` field — this is app state, not part
   *  of the Appendix A contract, so it never needs stripping in toAppendixA(). */
  practiceProgress: Map<string, { confidence: "low" | "medium" | "high"; updated_at: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const KitSchema = new Schema<KitDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    inputHash: { type: String, required: true, index: true },
    inputJd: { type: String, required: true },
    inputCompanyUrl: { type: String, required: true },
    inputDays: { type: Number, required: true },
    status: {
      type: String,
      enum: ["generating", "ready", "failed"],
      default: "generating",
      required: true,
    },
    failureReason: { type: String },
    version: { type: Number, default: 0 },
    kit: { type: KitDataSchema, required: false },
    practiceProgress: {
      type: Map,
      of: new Schema(
        {
          confidence: { type: String, enum: ["low", "medium", "high"], required: true },
          updated_at: { type: String, required: true },
        },
        { _id: false }
      ),
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

// A user can have multiple kits for the same input hash (explicit "regenerate
// fresh" should be allowed), but the service layer checks this index before
// creating a new one to avoid accidental duplicate generation — see Section 10:
// "the same description and company are submitted twice."
KitSchema.index({ userId: 1, inputHash: 1 });

export const Kit = model<KitDoc>("Kit", KitSchema);
