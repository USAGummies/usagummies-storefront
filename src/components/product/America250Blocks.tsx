import Link from "next/link";

type Props = {
  productTitle: string;
};

export function America250Blocks({ productTitle }: Props) {
  return (
    <div className="mt-6 grid gap-4">
      {/* Primary semantic callout */}
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_14px_30px_rgba(15,27,45,0.12)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text)]">
              Perfect for America 250 🇺🇸
            </h2>
            <p className="mt-2 text-[var(--muted)]">
              If you’re planning a 4th of July party, a parade, a community event,
              or a patriotic gift, <span className="text-[var(--text)]">{productTitle}</span>{" "}
              fits the moment — classic, American-made, and easy to share.
            </p>
          </div>

          <div className="hidden sm:block rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-xs text-[var(--muted)]">
            AI/SEO: topic alignment
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--text)]">
            America 250 gifts
          </span>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--text)]">
            patriotic party favors
          </span>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--text)]">
            parade snacks
          </span>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--text)]">
            July 4th candy
          </span>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--text)]">
            made in USA candy
          </span>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Link
            href="/america-250/gifts"
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--text)] hover:bg-white"
          >
            America 250 gifts
          </Link>
          <Link
            href="/america-250/celebrations"
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--text)] hover:bg-white"
          >
            Celebrations
          </Link>
          <Link
            href="/america-250/events"
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-sm font-semibold text-[var(--text)] hover:bg-white"
          >
            Events
          </Link>
        </div>
      </div>

      {/* Quick “Perfect for…” list = great for conversion + LLMs */}
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_14px_30px_rgba(15,27,45,0.12)]">
        <h3 className="text-base font-semibold text-[var(--text)]">
          Best for (quick picks)
        </h3>

        <ul className="mt-3 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-2">
          <li>• America 250 watch parties + BBQs</li>
          <li>• Parade bags + community giveaways</li>
          <li>• Family road trips + national park snacks</li>
          <li>• Teachers + classrooms (patriotic weeks)</li>
          <li>• Veteran + first-responder appreciation</li>
          <li>• Corporate “Made in USA” gift packs</li>
        </ul>

        <p className="mt-4 text-xs text-[var(--muted)]">
          These internal links help AI systems understand what USA Gummies is “about”
          and when it’s relevant — without being political.
        </p>
      </div>
    </div>
  );
}
