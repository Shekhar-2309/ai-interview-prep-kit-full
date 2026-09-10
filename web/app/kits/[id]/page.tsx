"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Shell } from "../../../components/Shell";
import { GenerationProgress } from "../../../components/GenerationProgress";
import { BuilderView } from "../../../components/BuilderView";
import { useRequireAuth } from "../../../lib/auth-context";
import { api } from "../../../lib/api";

const POLL_INTERVAL_MS = 3000;

export default function KitDetailPage() {
  const { userId, loading: authLoading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId");

  const [kit, setKit] = useState<any>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [version, setVersion] = useState<number>(0);

  const refetch = useCallback(async () => {
    const res = await api.getKit(params.id);
    setKit(res.kit);
    setStatus(res.status);
    setFailureReason(res.failureReason);
    setVersion(res.version);
  }, [params.id]);

  useEffect(() => {
    if (userId) refetch();
  }, [userId, refetch]);

  // Fallback poll for the case where the page was loaded without a runId
  // (e.g. returning to an in-progress kit later, or from the list page) —
  // Section 13: kits must be reopenable and continuable.
  useEffect(() => {
    if (!userId || runId || status !== "generating") return;
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [userId, runId, status, refetch]);

  if (authLoading || !userId || status === null) return null;

  return (
    <Shell>
      {status === "generating" && runId && (
        <GenerationProgress kitId={params.id} runId={runId} onDone={refetch} />
      )}
      {status === "generating" && !runId && (
        <div className="max-w-md mx-auto px-6 py-16 text-center">
          <p className="text-ink font-mono">Still building this kit…</p>
          <p className="text-ink-faint text-sm mt-1">This page will update automatically.</p>
        </div>
      )}
      {status === "failed" && (
        <div className="max-w-md mx-auto px-6 py-16">
          <div className="border border-alert bg-alert/5 p-4">
            <p className="text-alert text-sm font-medium mb-1">This kit couldn't be built</p>
            <p className="text-ink-faint text-sm">{failureReason}</p>
          </div>
        </div>
      )}
      {status === "ready" && kit && <BuilderView kitId={params.id} initialKit={kit} initialVersion={version} />}
    </Shell>
  );
}
