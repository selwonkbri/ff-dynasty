"use client";

import { useState } from "react";

interface ReadBackResult {
  matched: boolean;
  toStart: Array<{ slot: string; name: string }>;
  toBench: Array<{ name: string }>;
}

export default function ReadBackButton() {
  const [result, setResult] = useState<ReadBackResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/readback", { method: "POST" });
      if (!res.ok) throw new Error(`Read-back failed: ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Read-back failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Checking Sleeper..." : "Confirm swaps made in Sleeper"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="rounded-md border border-neutral-200 p-3 text-sm">
          {result.matched ? (
            <p className="text-green-700">Sleeper starters now match the optimal lineup.</p>
          ) : (
            <>
              <p className="text-amber-800">Not yet matched:</p>
              <ul className="mt-1 flex flex-col gap-1">
                {result.toStart.map((s, i) => (
                  <li key={`start-${i}`}>
                    start {s.name} at {s.slot}
                  </li>
                ))}
                {result.toBench.map((b, i) => (
                  <li key={`bench-${i}`}>bench {b.name}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
