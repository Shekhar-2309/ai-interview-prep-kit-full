"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password);
      router.push("/kits");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-mono text-2xl font-semibold text-ink mb-1">Create an account</h1>
        <p className="text-ink-faint text-sm mb-8">Takes about ten seconds.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm text-ink mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-line bg-surface px-3 py-2 text-ink"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm text-ink mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-line bg-surface px-3 py-2 text-ink"
            />
            <p className="text-xs text-ink-faint mt-1">At least 8 characters.</p>
          </div>

          {error && <p className="text-alert text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-ink text-surface font-mono py-2.5 hover:bg-ink/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-sm text-ink-faint mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-pen underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
