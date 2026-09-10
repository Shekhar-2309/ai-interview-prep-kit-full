import { GroqClient } from "../../core/generation/groqClient";
import { makeFetchPage } from "./fetchPage";
import { runPipeline, PipelineFatalError } from "../../core/pipeline/runPipeline";
import { saveGeneratedKit, markRunStep, markRunFailed } from "./kitService";
import { publish } from "./sseHub";

export interface GenerationEnv {
  groqApiKey: string;
  isProduction: boolean;
}

/**
 * Runs the pipeline for a kit that's already been created (status:
 * "generating") and persists the result. Intended to be fired-and-forgotten
 * by the route handler right after startKitGeneration() returns, so the HTTP
 * response can return immediately with the run id for the client to stream
 * progress against.
 */
export async function runGenerationJob(
  kitId: string,
  runId: string,
  input: { jd: string; companyUrl: string; days: number },
  env: GenerationEnv
): Promise<void> {
  const llm = new GroqClient({ apiKey: env.groqApiKey });
  const fetchPage = makeFetchPage({ isProduction: env.isProduction });

  try {
    const { kit } = await runPipeline(
      { jd: input.jd, companyUrl: input.companyUrl, days: input.days },
      {
        llm,
        fetchPage,
        onProgress: (event) => {
          // Fire-and-forget: don't let a slow DB write stall the pipeline.
          markRunStep(runId, event.step).catch(() => undefined);
          publish(runId, "progress", event);
        },
      }
    );

    await saveGeneratedKit(kitId, runId, kit);
    publish(runId, "completed", { kitId });
  } catch (err) {
    console.error("Generation failed:", err);
    const message =
      err instanceof PipelineFatalError
        ? err.message
        : err instanceof Error
        ? err.message
        : "unknown generation error";
    await markRunFailed(runId, kitId, message);
    publish(runId, "failed", { error: message });
  }
}
