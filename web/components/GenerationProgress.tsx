"use client";

import { useKitProgress, STEP_LABELS, STEP_ORDER, PipelineStep } from "../lib/use-kit-progress";

export function GenerationProgress({
  kitId,
  runId,
  onDone,
}: {
  kitId: string;
  runId: string;
  onDone: () => void;
}) {
  const { status, currentStep, error } = useKitProgress(kitId, runId);

  if (status === "completed") {
    onDone();
    return null;
  }

  const currentIndex = currentStep ? STEP_ORDER.indexOf(currentStep) : -1;

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <h1 className="font-mono text-xl font-semibold text-ink mb-1">Building your kit</h1>
      <p className="text-ink-faint text-sm mb-8">
        This takes a minute — we're reading the posting, checking the company site, and writing
        questions in a few separate passes.
      </p>

      <ol className="space-y-0">
        {STEP_ORDER.map((step, i) => {
          const isDone = currentIndex > i;
          const isCurrent = currentIndex === i && status === "running";
          return (
            <li
              key={step}
              className="flex items-center gap-3 py-2.5 border-b border-line last:border-none"
            >
              <span
                className={`w-2 h-2 shrink-0 rounded-full ${
                  isDone ? "bg-pen" : isCurrent ? "bg-highlight" : "bg-line"
                }`}
                aria-hidden="true"
              />
              <span
                className={`text-sm ${
                  isCurrent
                    ? "text-ink font-medium highlighter-mark"
                    : isDone
                    ? "text-ink-faint"
                    : "text-ink-faint/60"
                }`}
              >
                {STEP_LABELS[step as PipelineStep]}
              </span>
            </li>
          );
        })}
      </ol>

      {status === "failed" && (
        <div className="mt-8 border border-alert bg-alert/5 p-4">
          <p className="text-alert text-sm font-medium mb-1">Generation didn't finish</p>
          <p className="text-ink-faint text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
