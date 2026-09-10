import { Schema, model, Document, Types } from "mongoose";

export interface UserDoc extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      // Deliberately light validation — Section 1 says keep auth minimal.
      // We're not building a full RFC 5322 validator for a scoped assessment.
      match: [/^\S+@\S+\.\S+$/, "invalid email"],
    },
    passwordHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const User = model<UserDoc>("User", UserSchema);
