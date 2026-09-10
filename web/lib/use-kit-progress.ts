"use client";

import { useEffect, useState } from "react";
import { kitProgressStreamUrl } from "./api";

export type PipelineStep =
  | "extracting_requirements"
  | "crawling_company_site"
  | "searching_discussion"
  | "generating_brief"
  | "generating_questions"
  | "checking_coverage"
  | "building_schedule"
  | "validating";

export const STEP_LABELS: Record<PipelineStep, string> = {
  extracting_requirements: "Reading the job description",
  crawling_company_site: "Looking around the company site",
  searching_discussion: "Searching for interview discussion",
  generating_brief: "Writing the company brief",
  generating_questions: "Writing questions",
  checking_coverage: "Checking for gaps",
  building_schedule: "Building your schedule",
  validating: "Double-checking the kit",
};

export const STEP_ORDER: PipelineStep[] = [
  "extracting_requirements",
  "crawling_company_site",
  "searching_discussion",
  "generating_brief",
  "generating_questions",
  "checking_coverage",
  "building_schedule",
  "validating",
];

interface ProgressState {
  status: "connecting" | "running" | "completed" | "failed";
  currentStep: PipelineStep | null;
  error: string | null;
}

export function useKitProgress(kitId: string, runId: string): ProgressState {
  const [state, setState] = useState<ProgressState>({
    status: "connecting",
    currentStep: null,
    error: null,
  });

  useEffect(() => {
    const es = new EventSource(kitProgressStreamUrl(kitId, runId), { withCredentials: true });

    es.addEventListener("connected", () => {
      setState((s) => ({ ...s, status: "running" }));
    });

    es.addEventListener("progress", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setState((s) => ({ ...s, status: "running", currentStep: data.step }));
    });

    es.addEventListener("completed", () => {
      setState((s) => ({ ...s, status: "completed" }));
      es.close();
    });

    es.addEventListener("failed", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setState((s) => ({ ...s, status: "failed", error: data.error }));
      es.close();
    });

    es.onerror = () => {
      // EventSource auto-retries on transient network errors; we only
      // surface a hard failure via the explicit "failed" event above.
    };

    return () => es.close();
  }, [kitId, runId]);

  return state;
}
