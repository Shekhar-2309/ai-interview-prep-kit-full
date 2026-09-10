"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { BuilderContext } from "./BuilderView";
import { OriginMark } from "./OriginMark";

export function BuilderFlashcardsTab({ ctx }: { ctx: BuilderContext }) {
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setAdding((v) => !v)} className="text-pen text-sm underline">
          Add flashcard
        </button>
      </div>

      {adding && <AddFlashcardForm ctx={ctx} onDone={() => setAdding(false)} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ctx.kit.flashcards.map((f: any) => (
          <FlashcardCard key={f.id} flashcard={f} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function FlashcardCard({ flashcard, ctx }: { flashcard: any; ctx: BuilderContext }) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(flashcard.front);
  const [back, setBack] = useState(flashcard.back);

  async function save() {
    await ctx.mutate((kitId, version) => api.editFlashcard(kitId, flashcard.id, version, { front, back }) as any);
    setEditing(false);
  }

  async function remove() {
    await ctx.mutate((kitId, version) => api.deleteFlashcard(kitId, flashcard.id, version) as any);
  }

  if (editing) {
    return (
      <div className="card-tab bg-surface border border-line p-4 space-y-2">
        <textarea
          value={front}
          onChange={(e) => setFront(e.target.value)}
          rows={2}
          className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
        />
        <textarea
          value={back}
          onChange={(e) => setBack(e.target.value)}
          rows={2}
          className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={ctx.busy}
            className="bg-ink text-surface font-mono text-xs px-3 py-1.5 hover:bg-ink/90 disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} className="text-ink-faint text-xs px-3 py-1.5">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card-tab bg-surface border border-line p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-ink text-sm font-medium">{flashcard.front}</p>
        <OriginMark meta={flashcard._meta} />
      </div>
      <p className="text-ink-faint text-xs leading-relaxed mb-3">{flashcard.back}</p>
      <div className="flex gap-3 text-xs">
        <button onClick={() => setEditing(true)} className="text-pen underline">
          Edit
        </button>
        <button onClick={remove} className="text-alert underline">
          Delete
        </button>
      </div>
    </div>
  );
}

function AddFlashcardForm({ ctx, onDone }: { ctx: BuilderContext; onDone: () => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  async function submit() {
    if (!front.trim() || !back.trim()) return;
    await ctx.mutate((kitId, version) =>
      api.addFlashcard(kitId, version, { front, back, requirement_ids: [] }) as any
    );
    onDone();
  }

  return (
    <div className="card-tab bg-surface border border-line border-dashed p-4 mb-4 space-y-2 max-w-sm">
      <textarea
        value={front}
        onChange={(e) => setFront(e.target.value)}
        placeholder="Front"
        rows={2}
        className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
      />
      <textarea
        value={back}
        onChange={(e) => setBack(e.target.value)}
        placeholder="Back"
        rows={2}
        className="w-full border border-line bg-white px-2 py-1.5 text-sm text-ink"
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={ctx.busy}
          className="bg-ink text-surface font-mono text-xs px-3 py-1.5 hover:bg-ink/90 disabled:opacity-50"
        >
          Add
        </button>
        <button onClick={onDone} className="text-ink-faint text-xs px-3 py-1.5">
          Cancel
        </button>
      </div>
    </div>
  );
}
