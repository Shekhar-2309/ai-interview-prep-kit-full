import mongoose from "mongoose";

let connected = false;

export async function connectDB(uri: string): Promise<void> {
  if (connected) return;
  if (!uri) {
    throw new Error("MONGODB_URI is not set — see .env.example");
  }
  await mongoose.connect(uri);
  connected = true;
  // eslint-disable-next-line no-console
  console.log("MongoDB connected");
}

export async function disconnectDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
