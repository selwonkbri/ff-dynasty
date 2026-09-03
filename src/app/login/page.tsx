"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });

    setSubmitting(false);

    if (!res.ok) {
      setError("Incorrect secret");
      return;
    }

    const from = searchParams.get("from") || "/";
    router.push(from);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-xs flex-col gap-3"
    >
      <label htmlFor="secret" className="text-sm font-medium text-neutral-700">
        App secret
      </label>
      <input
        id="secret"
        type="password"
        autoFocus
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        className="rounded-md border border-neutral-300 px-3 py-2 text-base"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !secret}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Checking..." : "Enter"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-lg font-semibold">Legacy League Dynasty Tool</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
