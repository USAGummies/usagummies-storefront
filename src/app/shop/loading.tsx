export default function LoadingShop() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      {/* Header skeleton */}
      <div className="mb-6">
        <div className="h-4 w-56 rounded bg-neutral-200" />
        <div className="mt-4 h-10 w-72 rounded bg-neutral-200" />
        <div className="mt-3 h-4 w-full max-w-2xl rounded bg-neutral-200" />
        <div className="mt-2 h-4 w-full max-w-xl rounded bg-neutral-200" />

        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-md">
              <div className="h-4 w-20 rounded bg-neutral-200" />
              <div className="mt-2 h-11 w-full rounded-xl bg-neutral-100" />
              <div className="mt-2 h-3 w-48 rounded bg-neutral-200" />
            </div>
            <div className="w-full sm:w-64">
              <div className="h-4 w-16 rounded bg-neutral-200" />
              <div className="mt-2 h-11 w-full rounded-xl bg-neutral-100" />
              <div className="mt-2 h-3 w-24 rounded bg-neutral-200" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="h-7 w-20 rounded-full bg-neutral-200" />
            <div className="h-7 w-44 rounded-full bg-neutral-200" />
            <div className="h-7 w-32 rounded-full bg-neutral-200" />
            <div className="ml-auto h-3 w-52 rounded bg-neutral-200" />
          </div>
        </div>
      </div>

      {/* Grid skeleton */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading products">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"
          >
            <div className="aspect-square w-full bg-neutral-100" />
            <div className="p-4">
              <div className="h-4 w-5/6 rounded bg-neutral-200" />
              <div className="mt-2 h-3 w-1/3 rounded bg-neutral-200" />
              <div className="mt-4 h-4 w-1/2 rounded bg-neutral-200" />
              <div className="mt-4 h-10 w-full rounded-xl bg-neutral-900/20" />
            </div>
          </div>
        ))}
      </section>

      {/* Pagination skeleton */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="h-10 w-28 rounded-xl bg-neutral-200" />
          <div className="h-10 w-24 rounded-xl bg-neutral-200" />
        </div>
        <div className="h-4 w-72 rounded bg-neutral-200" />
      </div>
    </main>
  );
}
