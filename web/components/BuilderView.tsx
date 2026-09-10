"use client";

import { useState, useCallback } from "react";
import { api, ApiError } from "../lib/api";
import { BuilderQuestionsTab } from "./BuilderQuestionsTab";
import { BuilderFlashcardsTab } from "./BuilderFlashcardsTab";
import { BuilderBriefTab } from "./BuilderBriefTab";
import { BuilderScheduleTab } from "./BuilderScheduleTab";
import { RoleTab } from "./RoleTab";
import { PracticeMode } from "./PracticeMode";
import { WeakSpotsTab } from "./WeakSpotsTab";

const TABS = ["Brief", "Role", "Questions", "Flashcards", "Schedule", "Practice", "Weak spots"] as const;
type Tab = (typeof TABS)[number];

export interface BuilderContext {
  kitId: string;
  kit: any;
  version: number;
  /** Wraps any mutating api.ts call: applies the result, surfaces conflicts/errors. */
  mutate: (fn: (kitId: string, version: number) => Promise<{ kit: any; version: number }>) => Promise<void>;
  busy: boolean;
}

export function BuilderView({
  kitId,
  initialKit,
  initialVersion,
}: {
  kitId: string;
  initialKit: any;
  initialVersion: number;
}) {
  const [tab, setTab] = useState<Tab>("Brief");
  const [kit, setKit] = useState(initialKit);
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await api.getKit(kitId);
    setKit(res.kit);
    setVersion(res.version);
    setConflict(false);
  }, [kitId]);

  const mutate: BuilderContext["mutate"] = useCallback(
    async (fn) => {
      setBusy(true);
      setErrorMsg(null);
      try {
        const result = await fn(kitId, version);
        setKit(result.kit);
        setVersion(result.version);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setConflict(true);
        } else {
          setErrorMsg(err instanceof ApiError ? err.message : "That didn't save. Try again.");
        }
      } finally {
        setBusy(false);
      }
    },
    [kitId, version]
  );

  const ctx: BuilderContext = { kitId, kit, version, mutate, busy };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <header className="mb-8">
        <h1 className="font-mono text-2xl font-semibold text-ink">{kit.role?.title || "Untitled role"}</h1>
        <p className="text-ink-faint text-sm mt-1">
          {kit.source?.company} · {kit.schedule?.days_available} day
          {kit.schedule?.days_available === 1 ? "" : "s"} to prep
        </p>
      </header>

      {conflict && (
        <div className="mb-6 border border-alert bg-alert/5 p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-ink">
            This kit changed elsewhere (maybe another tab). Reload to see the latest before editing further.
          </p>
          <button
            onClick={reload}
            className="shrink-0 bg-ink text-surface font-mono text-sm px-3 py-1.5 hover:bg-ink/90"
          >
            Reload
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="mb-6 border border-alert bg-alert/5 p-3">
          <p className="text-sm text-alert">{errorMsg}</p>
        </div>
      )}

      <nav className="flex gap-1 mb-8 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`card-tab-sm px-4 py-2 text-sm font-mono border border-b-0 ${
              tab === t
                ? "bg-surface text-ink border-line relative -mb-px z-10"
                : "bg-transparent text-ink-faint border-transparent hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="border-t border-line -mt-8 mb-8" />

      {tab === "Brief" && <BuilderBriefTab ctx={ctx} />}
      {tab === "Role" && <RoleTab kit={kit} />}
      {tab === "Questions" && <BuilderQuestionsTab ctx={ctx} />}
      {tab === "Flashcards" && <BuilderFlashcardsTab ctx={ctx} />}
      {tab === "Schedule" && <BuilderScheduleTab ctx={ctx} />}
      {tab === "Practice" && <PracticeMode kitId={kitId} kit={kit} />}
      {tab === "Weak spots" && <WeakSpotsTab kitId={kitId} />}
    </div>
  );
}
