export function TrustBar({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <section className={compact ? "py-6" : "py-10"}>
      <div className="rounded-3xl border border-white/12 bg-white/5 p-6 backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white/90">
              Built for conversion. Backed by trust.
            </h2>
            <p className="mt-1 text-sm text-white/70">
              Fast shipping, secure Shopify checkout, and bundle value that rewards stocking up.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Pill title="Fast Shipping" desc="Ships quickly from the USA" />
            <Pill title="Secure Checkout" desc="Shopify-powered checkout" />
            <Pill title="Free Shipping 5+" desc="Free shipping on 5+ bags" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Pill({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="min-w-[200px] rounded-2xl border border-white/12 bg-white/5 p-4 backdrop-blur">
      <div className="text-sm font-semibold text-white/90">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-white/70">{desc}</div>
    </div>
  );
}
