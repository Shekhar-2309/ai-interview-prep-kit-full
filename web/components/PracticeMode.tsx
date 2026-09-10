"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Confidence = "low" | "medium" | "high";

export function PracticeMode({ kitId, kit }: { kitId: string; kit: any }) {
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<Record<string, { confidence: Confidence }>>({});
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  async function loadSession() {
    const res = await api.getPracticeSession(kitId);
    setOrderedIds(res.orderedFlashcardIds);
    setProgress(res.progress as any);
    setIndex(0);
    setRevealed(false);
  }

  useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitId]);

  if (!orderedIds) return <p className="text-ink-faint text-sm">Loading…</p>;

  if (orderedIds.length === 0) {
    return <p className="text-ink-faint text-sm">No flashcards in this kit yet.</p>;
  }

  const currentId = orderedIds[index];
  const current = kit.flashcards.find((f: any) => f.id === currentId);
  const coveredCount = Object.keys(progress).length;

  async function recordAndAdvance(confidence: Confidence) {
    await api.recordPracticeConfidence(kitId, currentId, confidence);
    setProgress((p) => ({ ...p, [currentId]: { confidence } }));

    if (index + 1 < orderedIds!.length) {
      setIndex(index + 1);
      setRevealed(false);
    }
  }

  const isLastCard = index + 1 >= orderedIds.length;
  const allReviewedThisPass = isLastCard && progress[currentId];

  if (!current) {
    return <p className="text-ink-faint text-sm">This card was removed. Restart the session.</p>;
  }

  return (
    <div className="max-w-md">
      <div className="flex items-center justify-between mb-6">
        <p className="text-xs font-mono text-ink-faint">
          Card {index + 1} of {orderedIds.length}
        </p>
        <p className="text-xs font-mono text-ink-faint">
          {coveredCount} of {kit.flashcards.length} covered
        </p>
      </div>

      <button
        onClick={() => setRevealed((r) => !r)}
        className="card-tab w-full bg-surface border border-line p-8 text-left min-h-[180px] flex items-center justify-center"
      >
        <p className="text-ink text-base text-center leading-relaxed">
          {revealed ? current.back : current.front}
        </p>
      </button>
      <p className="text-center text-xs text-ink-faint mt-2">
        {revealed ? "That's the answer outline. How confident did you feel?" : "Tap the card to reveal the answer."}
      </p>

      {revealed && (
        <div className="flex gap-2 mt-6 justify-center">
          <ConfidenceButton label="Not confident" onClick={() => recordAndAdvance("low")} />
          <ConfidenceButton label="Somewhat" onClick={() => recordAndAdvance("medium")} />
          <ConfidenceButton label="Confident" onClick={() => recordAndAdvance("high")} />
        </div>
      )}

      {allReviewedThisPass && (
        <div className="mt-8 text-center">
          <p className="text-ink text-sm mb-3">You've been through every card this session.</p>
          <button onClick={loadSession} className="text-pen text-sm underline">
            Start again, least confident first
          </button>
        </div>
      )}
    </div>
  );
}

function ConfidenceButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border border-line bg-surface text-ink text-xs font-mono px-3 py-2 hover:border-pen hover:text-pen transition-colors"
    >
      {label}
    </button>
  );
}
