"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface WeakSpot {
  requirementId: string;
  requirementText: string;
  priority: string;
  reason: string;
  riskScore: number;
}

export function WeakSpotsTab({ kitId }: { kitId: string }) {
  const [spots, setSpots] = useState<WeakSpot[] | null>(null);

  async function load() {
    const res = await api.getWeakSpots(kitId);
    setSpots(res.weakSpots);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitId]);

  if (!spots) return <p className="text-ink-faint text-sm">Loading…</p>;

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-ink-faint text-sm">
          If you only have twenty minutes left, review these in order.
        </p>
        <button onClick={load} className="text-pen text-sm underline shrink-0">
          Refresh
        </button>
      </div>

      {spots.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing flagged yet — practice a few flashcards first.</p>
      ) : (
        <ol className="space-y-0">
          {spots.map((spot, i) => (
            <li key={spot.requirementId} className="flex items-start gap-3 py-3 border-b border-line last:border-none">
              <span className="font-mono text-sm text-ink-faint w-5 shrink-0">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-ink text-sm">{spot.requirementText}</p>
                <p className="text-ink-faint text-xs mt-0.5">{spot.reason}</p>
              </div>
              <span
                className={`shrink-0 text-xs font-mono px-1.5 py-0.5 ml-auto ${
                  spot.priority === "must" ? "bg-highlight text-ink" : "border border-line text-ink-faint"
                }`}
              >
                {spot.priority}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
