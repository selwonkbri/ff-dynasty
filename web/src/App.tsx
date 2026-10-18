import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLive, LoadError, readCache, saveCache, type LoadResult } from "./data";
import { buildPageModel, type PageModel } from "./model";
import { fmtClock } from "./format";
import Lineup from "./tabs/Lineup";
import Dashboard from "./tabs/Dashboard";
import FreeAgents from "./tabs/FreeAgents";

const TABS = [
  { hash: "#/lineup", label: "Lineup" },
  { hash: "#/dashboard", label: "Dashboard" },
  { hash: "#/free-agents", label: "Free agents" },
] as const;
type TabHash = (typeof TABS)[number]["hash"];

function currentTab(): TabHash {
  return TABS.find((t) => t.hash === window.location.hash)?.hash ?? "#/lineup";
}

export default function App() {
  const [tab, setTab] = useState<TabHash>(currentTab);
  const [result, setResult] = useState<LoadResult | null>(() => readCache());
  const [fromCache, setFromCache] = useState(() => result !== null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string[]>([]);

  // Every state update happens in a callback after the network responds, so the
  // initial load can run from an effect; `loading` starts true for that load.
  const load = useCallback(
    () =>
      loadLive()
        .then(
          (fresh) => {
            setResult(fresh);
            setFromCache(false);
            setFailed([]);
            saveCache(fresh);
          },
          (err: unknown) => {
            setFailed(err instanceof LoadError ? err.failed : ["Sleeper (network error)"]);
          },
        )
        .finally(() => setLoading(false)),
    [],
  );

  const refresh = () => {
    setLoading(true);
    void load();
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const { model, modelError } = useMemo((): { model: PageModel | null; modelError: string | null } => {
    if (!result) return { model: null, modelError: null };
    try {
      return { model: buildPageModel(result.inputs, new Date()), modelError: null };
    } catch (err) {
      return { model: null, modelError: err instanceof Error ? err.message : "Couldn't compute the lineup." };
    }
  }, [result]);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Legacy League</p>
          <div className="flex items-center gap-2">
            {result && (
              <span className="text-xs text-neutral-500">
                {fromCache ? "Saved" : "As of"} {fmtClock(result.fetchedAt)}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
        <nav className="mt-2 flex gap-4 text-sm font-medium">
          {TABS.map((t) => (
            <a
              key={t.hash}
              href={t.hash}
              aria-current={tab === t.hash ? "page" : undefined}
              className={`border-b-2 pb-2 ${tab === t.hash ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500"}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {failed.length > 0 && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {`Couldn't load ${failed.join(", ")}.`}
            {result ? ` Showing the saved result from ${fmtClock(result.fetchedAt)}.` : " Tap Refresh to try again."}
          </div>
        )}
        {result?.warnings.map((w) => (
          <p key={w} className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            {w}
          </p>
        ))}
        {modelError && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {modelError}
          </div>
        )}
        {!result && loading && <p className="text-sm text-neutral-500">Loading from Sleeper...</p>}
        {model && tab === "#/lineup" && <Lineup model={model} />}
        {model && tab === "#/dashboard" && <Dashboard model={model} />}
        {model && tab === "#/free-agents" && <FreeAgents model={model} />}
      </main>
    </div>
  );
}
