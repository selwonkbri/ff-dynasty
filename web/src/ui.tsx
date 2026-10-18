import type { ReactNode } from "react";
import { injuryFlag } from "@lib/engine/lineupNotes";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

// Every empty list renders one of these instead of nothing.
export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" }) {
  const tones = {
    muted: "text-neutral-500",
    good: "text-green-700",
    warn: "text-amber-800",
    bad: "text-red-700",
  };
  return <p className={`text-sm ${tones[tone]}`}>{children}</p>;
}

export function InjuryChip({ status }: { status: string | null }) {
  const flag = injuryFlag(status);
  if (!flag) return null;
  const cls = flag === "red" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900";
  return (
    <span data-injury={flag} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {status}
    </span>
  );
}

export function LockChip({ locked }: { locked: boolean }) {
  if (!locked) return null;
  return (
    <span data-locked="true" className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-700">
      Locked
    </span>
  );
}

const SLOT_LABELS: Record<string, string> = { SUPER_FLEX: "SF", FLEX: "FLEX" };

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot;
}
