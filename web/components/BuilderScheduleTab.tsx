"use client";

import { api } from "../lib/api";
import { BuilderContext } from "./BuilderView";

export function BuilderScheduleTab({ ctx }: { ctx: BuilderContext }) {
  async function regenerate() {
    await ctx.mutate((kitId, version) =>
      api.regenerateSection(kitId, version, { section: "schedule" }) as any
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={regenerate} disabled={ctx.busy} className="text-pen text-sm underline disabled:opacity-50">
          Regenerate schedule
        </button>
      </div>
      <div className="space-y-2">
        {ctx.kit.schedule.days.map((d: any) => (
          <div key={d.day} className="flex items-center gap-4 border-b border-line py-3">
            <span className="font-mono text-sm text-ink-faint w-12 shrink-0">Day {d.day}</span>
            <div className="flex-1 min-w-0">
              <p className="text-ink text-sm">{d.focus}</p>
              <p className="text-ink-faint text-xs">
                {d.question_ids.length} question{d.question_ids.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="text-xs font-mono text-ink-faint shrink-0">{d.minutes} min</span>
          </div>
        ))}
      </div>
    </div>
  );
}
