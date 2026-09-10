"use client";

import Link from "next/link";
import { useAuth } from "../lib/auth-context";

export function Shell({ children }: { children: React.ReactNode }) {
  const { userId, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/kits" className="font-mono font-semibold text-lg text-ink tracking-tight">
            prep kit
          </Link>
          {userId && (
            <button
              onClick={() => logout()}
              className="text-sm text-ink-faint hover:text-ink transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
