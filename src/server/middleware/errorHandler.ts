import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AuthError } from "../services/authService";
import { NotFoundError, ForbiddenError, ConflictError } from "../services/kitService";
import { VersionConflictError } from "../services/kitBuilderService";
import { PipelineFatalError } from "../../core/pipeline/runPipeline";

interface StructuredError {
  error: { code: string; message: string; details?: unknown };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const response = mapError(err);
  res.status(response.status).json(response.body);

  // Structured server-side log — don't leak internals to the client, but
  // don't lose them either.
  if (response.status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

function mapError(err: unknown): { status: number; body: StructuredError } {
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "request failed validation",
          details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
    };
  }
  if (err instanceof AuthError) {
    return { status: err.statusCode, body: { error: { code: "AUTH_ERROR", message: err.message } } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: { code: "NOT_FOUND", message: err.message } } };
  }
  if (err instanceof ForbiddenError) {
    return { status: 403, body: { error: { code: "FORBIDDEN", message: err.message } } };
  }
  if (err instanceof ConflictError) {
    return {
      status: 409,
      body: { error: { code: "CONFLICT", message: err.message, details: { existingKitId: err.existingKitId } } },
    };
  }
  if (err instanceof VersionConflictError) {
    return { status: 409, body: { error: { code: "VERSION_CONFLICT", message: err.message } } };
  }
  if (err instanceof PipelineFatalError) {
    return { status: 422, body: { error: { code: "GENERATION_FAILED", message: err.message } } };
  }

  const message = err instanceof Error ? err.message : "unexpected server error";
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message } } };
}

/** Wraps an async route handler so rejected promises reach errorHandler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
