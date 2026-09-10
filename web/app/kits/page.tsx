"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "../../components/Shell";
import { KitCreateForm } from "../../components/KitCreateForm";
import { useRequireAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

interface KitSummary {
  id: string;
  status: string;
  role: string | null;
  company: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  generating: "Building…",
  ready: "Ready",
  failed: "Failed",
};

export default function KitsPage() {
  const { userId, loading } = useRequireAuth();
  const [kits, setKits] = useState<KitSummary[] | null>(null);

  useEffect(() => {
    if (userId) {
      api.listKits().then((res) => setKits(res.kits));
    }
  }, [userId]);

  if (loading || !userId) return null; // useRequireAuth is already redirecting

  return (
    <Shell>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <section className="mb-14">
          <h1 className="font-mono text-2xl font-semibold text-ink mb-1">New kit</h1>
          <p className="text-ink-faint text-sm mb-6">
            Paste a job description and we'll do the research.
          </p>
          <KitCreateForm />
        </section>

        {kits && kits.length > 0 && (
          <section>
            <h2 className="font-mono text-lg font-semibold text-ink mb-4">Your kits</h2>
            <ul className="divide-y divide-line border-t border-b border-line">
              {kits.map((k) => (
                <li key={k.id}>
                  <Link
                    href={`/kits/${k.id}`}
                    className="flex items-center justify-between py-3 hover:bg-surface px-2 -mx-2 transition-colors"
                  >
                    <div>
                      <p className="text-ink text-sm font-medium">
                        {k.role ?? "Untitled role"}
                        {k.company ? ` · ${k.company}` : ""}
                      </p>
                      <p className="text-ink-faint text-xs mt-0.5">
                        {new Date(k.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-mono px-2 py-1 ${
                        k.status === "ready"
                          ? "text-pen"
                          : k.status === "failed"
                          ? "text-alert"
                          : "text-ink-faint"
                      }`}
                    >
                      {STATUS_LABEL[k.status] ?? k.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Shell>
  );
}
