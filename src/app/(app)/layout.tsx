import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="border-b border-neutral-200 px-4 py-3">
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/" className="text-neutral-900">
            Dashboard
          </Link>
          <Link href="/lineup" className="text-neutral-900">
            Lineup
          </Link>
          <Link href="/waivers" className="text-neutral-900">
            Free agents
          </Link>
        </nav>
      </header>
      <main className="flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
