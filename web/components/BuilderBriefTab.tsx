"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { BuilderContext } from "./BuilderView";
import { OriginMark } from "./OriginMark";

export function BuilderBriefTab({ ctx }: { ctx: BuilderContext }) {
  const brief = ctx.kit.company_brief;
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(brief.summary);
  const [whatTheyDo, setWhatTheyDo] = useState(brief.what_they_do);

  async function save() {
    await ctx.mutate((kitId, version) =>
      api.editBrief(kitId, version, { summary, what_they_do: whatTheyDo }) as any
    );
    setEditing(false);
  }

  async function regenerate() {
    await ctx.mutate((kitId, version) =>
      api.regenerateSection(kitId, version, {
        section: "company_brief",
        force: brief._meta?.locked === true,
      }) as any
    );
  }

  if (editing) {
    return (
      <div className="space-y-4 max-w-xl">
        <div>
          <label className="block text-sm text-ink mb-1">Summary</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className="w-full border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>
        <div>
          <label className="block text-sm text-ink mb-1">What they do</label>
          <textarea
            value={whatTheyDo}
            onChange={(e) => setWhatTheyDo(e.target.value)}
            rows={3}
            className="w-full border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={ctx.busy}
            className="bg-ink text-surface font-mono text-sm px-4 py-2 hover:bg-ink/90 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-ink-faint text-sm px-4 py-2 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-start justify-between gap-4">
        <p className="text-ink leading-relaxed">{brief.summary}</p>
        <OriginMark meta={brief._meta} />
      </div>
      <p className="text-ink-faint text-sm leading-relaxed">{brief.what_they_do}</p>

      {brief.sources?.length > 0 && (
        <div className="pt-1">
          <p className="text-xs text-ink-faint mb-1">Sources</p>
          <ul className="space-y-1">
            {brief.sources.map((s: string) => (
              <li key={s}>
                <a href={s} target="_blank" rel="noreferrer" className="text-pen text-sm underline break-all">
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-4 pt-2">
        <button onClick={() => setEditing(true)} className="text-pen text-sm underline">
          Edit
        </button>
        <button onClick={regenerate} disabled={ctx.busy} className="text-pen text-sm underline disabled:opacity-50">
          Regenerate{brief._meta?.locked ? " anyway" : ""}
        </button>
      </div>
    </div>
  );
}
