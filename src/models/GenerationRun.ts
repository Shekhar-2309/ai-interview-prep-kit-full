import { Schema, model, Document, Types } from "mongoose";

export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface GenerationRunDoc extends Document {
  _id: Types.ObjectId;
  kitId: Types.ObjectId;
  userId: Types.ObjectId;
  status: RunStatus;
  currentStep: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const GenerationRunSchema = new Schema<GenerationRunDoc>(
  {
    kitId: { type: Schema.Types.ObjectId, ref: "Kit", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed"],
      default: "pending",
      required: true,
    },
    currentStep: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

export const GenerationRun = model<GenerationRunDoc>("GenerationRun", GenerationRunSchema);
