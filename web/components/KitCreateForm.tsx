"use client";

import { useState, FormEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../lib/api";

interface BatchCase {
  jd: string;
  companyUrl: string;
  days: number;
}

export function KitCreateForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "batch">("single");

  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(5);
  const [batchCases, setBatchCases] = useState<BatchCase[] | null>(null);
  const [batchFileName, setBatchFileName] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBatchFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const cases: BatchCase[] = parsed.map((c: any) => ({
        jd: c.jd,
        companyUrl: c.company_url ?? c.companyUrl,
        days: c.days,
      }));
      setBatchCases(cases);
      setError(null);
    } catch {
      setError("Couldn't read that file — expecting a JSON array of { jd, company_url, days }.");
      setBatchCases(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "single") {
        const { kitId, runId } = await api.createKit({ jd, companyUrl, days });
        router.push(`/kits/${kitId}?runId=${runId}`);
      } else {
        if (!batchCases || batchCases.length === 0) {
          setError("Upload a file first.");
          return;
        }
        await api.createKitsBatch(batchCases);
        router.push("/kits");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex gap-1 border-b border-line">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`px-4 py-2 text-sm font-mono ${
            mode === "single" ? "text-ink border-b-2 border-highlight -mb-px" : "text-ink-faint"
          }`}
        >
          One role
        </button>
        <button
          type="button"
          onClick={() => setMode("batch")}
          className={`px-4 py-2 text-sm font-mono ${
            mode === "batch" ? "text-ink border-b-2 border-highlight -mb-px" : "text-ink-faint"
          }`}
        >
          Multiple roles
        </button>
      </div>

      {mode === "single" ? (
        <>
          <div>
            <label htmlFor="jd" className="block text-sm text-ink mb-1">
              Job description
            </label>
            <textarea
              id="jd"
              required
              rows={10}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the full posting here…"
              className="w-full border border-line bg-surface px-3 py-2 text-ink text-sm leading-relaxed"
            />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-4">
            <div>
              <label htmlFor="companyUrl" className="block text-sm text-ink mb-1">
                Company website
              </label>
              <input
                id="companyUrl"
                type="url"
                required
                value={companyUrl}
                onChange={(e) => setCompanyUrl(e.target.value)}
                placeholder="https://…"
                className="w-full border border-line bg-surface px-3 py-2 text-ink text-sm"
              />
            </div>
            <div>
              <label htmlFor="days" className="block text-sm text-ink mb-1">
                Days to prep
              </label>
              <input
                id="days"
                type="number"
                min={1}
                max={90}
                required
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full border border-line bg-surface px-3 py-2 text-ink text-sm"
              />
            </div>
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="batchFile" className="block text-sm text-ink mb-1">
            Upload a JSON file of roles
          </label>
          <p className="text-xs text-ink-faint mb-2">
            An array of {`{ jd, company_url, days }`} objects — one entry per role.
          </p>
          <input
            id="batchFile"
            type="file"
            accept="application/json"
            onChange={handleBatchFile}
            className="text-sm text-ink"
          />
          {batchCases && (
            <p className="text-sm text-pen mt-2">
              {batchFileName}: {batchCases.length} role{batchCases.length === 1 ? "" : "s"} found.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-alert text-sm">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="bg-ink text-surface font-mono px-5 py-2.5 hover:bg-ink/90 disabled:opacity-50 transition-colors"
      >
        {submitting ? "Starting…" : mode === "single" ? "Build my kit" : "Build these kits"}
      </button>
    </form>
  );
}
