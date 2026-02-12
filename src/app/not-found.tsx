import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="text-6xl font-black text-[var(--navy,#0f1b2d)]">404</div>
      <h1 className="mt-3 text-2xl font-black text-[var(--text,#0f1b2d)]">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm text-[var(--muted,#6b7280)]">
        The page you are looking for does not exist or has been moved.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="btn btn-candy">
          Back to home
        </Link>
        <Link href="/shop" className="btn btn-outline">
          Shop gummies
        </Link>
      </div>
    </main>
  );
}
