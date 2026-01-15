export function TrustBar({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <section className={compact ? "py-6" : "py-10"}>
      <div className="candy-panel rounded-3xl border border-[var(--border)] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text)]">
              Built for conversion. Backed by trust.
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Fast shipping, secure Shopify checkout, and bundle value that rewards stocking up.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Pill title="Fast Shipping" desc="Ships quickly from the USA" />
            <Pill title="Secure Checkout" desc="Shopify-powered checkout" />
            <Pill title="Free shipping on 5+ bags" desc="Free shipping on 5+ bags" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Pill({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="min-w-[200px] rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
      <div className="text-sm font-semibold text-[var(--text)]">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{desc}</div>
    </div>
  );
}
