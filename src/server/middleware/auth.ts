import session, { SessionOptions } from "express-session";
import MongoStore from "connect-mongo";
import { Request, Response, NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function buildSessionMiddleware(opts: { mongoUri: string; sessionSecret: string }) {
  if (!opts.sessionSecret) {
    throw new Error("SESSION_SECRET is not set — see .env.example");
  }

  const isProduction = process.env.NODE_ENV === "production";

  const config: SessionOptions = {
    secret: opts.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: opts.mongoUri, ttl: SESSION_MAX_AGE_MS / 1000 }),
    cookie: {
      httpOnly: true,
      // Frontend (Vercel) and backend (Render) are different domains once
      // deployed — cross-site cookies require sameSite: "none" + secure: true.
      // "lax" would silently break the session cookie in production while
      // working fine in local dev, which is an easy trap to miss.
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: SESSION_MAX_AGE_MS,
    },
  };

  return session(config);
}

/**
 * Guards protected routes. Section 1: "a signed-out visitor cannot reach
 * protected pages or endpoints" + "sensible handling of expired or invalid
 * sessions" — an expired/missing/tampered session just looks like "no
 * session," which this middleware rejects uniformly with a 401.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "sign in required" } });
    return;
  }
  next();
}

export function currentUserId(req: Request): string {
  const userId = req.session?.userId;
  if (!userId) {
    // Should be unreachable behind requireAuth — defensive guard if misused.
    throw new Error("currentUserId called outside an authenticated route");
  }
  return userId;
}
