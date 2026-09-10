import express, { Express } from "express";
import cors from "cors";
import { buildSessionMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/authRoutes";
import kitRoutes from "./routes/kitRoutes";
import { config } from "./config";

export function buildApp(): Express {
  const app = express();

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !process.env.FRONTEND_ORIGIN) {
    throw new Error(
      "FRONTEND_ORIGIN must be set in production — permissive CORS + credentials is unsafe. See .env.example."
    );
  }

  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN || true, // permissive fallback only reachable in dev, guarded above
      credentials: true, // required for session cookies across origins (Next.js frontend)
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    buildSessionMiddleware({
      mongoUri: config.mongodbUri,
      sessionSecret: config.sessionSecret,
    })
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/kits", kitRoutes);

  // Must be registered last — Express routes errors here from any
  // asyncHandler-wrapped controller.
  app.use(errorHandler);

  return app;
}
