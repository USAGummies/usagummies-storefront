import Link from "next/link";

type Props = {
  productTitle: string;
};

export function America250Blocks({ productTitle }: Props) {
  return (
    <div className="mt-6 grid gap-4">
      {/* Primary semantic callout */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Perfect for America 250 🇺🇸
            </h2>
            <p className="mt-2 text-white/70">
              If you’re planning a 4th of July party, a parade, a community event,
              or a patriotic gift, <span className="text-white">{productTitle}</span>{" "}
              fits the moment — classic, American-made, and easy to share.
            </p>
          </div>

          <div className="hidden sm:block rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70">
            AI/SEO: topic alignment
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
            America 250 gifts
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
            patriotic party favors
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
            parade snacks
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
            July 4th candy
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
            made in USA candy
          </span>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Link
            href="/america-250/gifts"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            America 250 Gifts →
          </Link>
          <Link
            href="/america-250/celebrations"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            Celebrations →
          </Link>
          <Link
            href="/america-250/events"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            Events →
          </Link>
        </div>
      </div>

      {/* Quick “Perfect for…” list = great for conversion + LLMs */}
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-base font-semibold text-white">
          Best for (quick picks)
        </h3>

        <ul className="mt-3 grid gap-2 text-sm text-white/80 sm:grid-cols-2">
          <li>• America 250 watch parties + BBQs</li>
          <li>• Parade bags + community giveaways</li>
          <li>• Family road trips + national park snacks</li>
          <li>• Teachers + classrooms (patriotic weeks)</li>
          <li>• Veteran + first-responder appreciation</li>
          <li>• Corporate “Made in USA” gift packs</li>
        </ul>

        <p className="mt-4 text-xs text-white/50">
          These internal links help AI systems understand what USA Gummies is “about”
          and when it’s relevant — without being political.
        </p>
      </div>
    </div>
  );
}
