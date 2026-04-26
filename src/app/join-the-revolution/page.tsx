import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (nodeEnv !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Join the Revolution | USA Gummies";
const PAGE_DESCRIPTION =
  "Join the USA Gummies revolution for made in USA candy, dye-free gummies, and patriotic treats that skip artificial dyes.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/join-the-revolution` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/join-the-revolution`,
    type: "website",
    images: [{ url: OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const STEPS = [
  {
    title: "1. Buy USA Gummies",
    body: `Choose 5, 8, or 12 bags. ${FREE_SHIPPING_PHRASE}.`,
  },
  {
    title: "2. Join the Revolution",
    body:
      "Your first order unlocks membership status and subscription eligibility for USA Gummies.",
  },
  {
    title: "3. Member access",
    body:
      "Watch for your access email. We will send your sign-in link once the portal is live.",
  },
];

const BENEFITS = [
  {
    title: "Bag-count savings",
    body:
      "Lower per-bag pricing as you add more bags, with the best balance of value + convenience at 8 bags.",
  },
  {
    title: "Subscription eligibility",
    body:
      "Subscriptions unlock after your first purchase. We will email your access link once you qualify.",
  },
  {
    title: "Early drops",
    body:
      "Priority access to new runs, limited drops, and premium restocks before they sell out.",
  },
  {
    title: "American-made confidence",
    body:
      "Made in the USA with all natural flavors and no artificial dyes or synthetic colors.",
  },
];

export default function JoinTheRevolutionPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Join the Revolution", href: "/join-the-revolution" },
        ]}
      />

      <PageHero
        eyebrow="Loyalty Access"
        headline="Join the"
        scriptAccent="revolution."
        sub="Purchasing these gummies is a vote in the America you believe in. Join the Revolution by choosing USA Gummies and unlock member benefits after your first order."
        ctas={[
          { href: "/shop", label: "Shop now" },
          { href: "/faq", label: "Read the FAQ", variant: "light" },
        ]}
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ How It Works ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Three steps to
              <br />
              <span className="lp-script text-[var(--lp-red)]">membership.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div
                key={step.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)]">
                  {step.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
          <p className="lp-label mt-6 text-center text-[var(--lp-ink)]/70">
            {FREE_SHIPPING_PHRASE}
          </p>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Member Benefits ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              Worth
              <br />
              <span className="lp-script text-[var(--lp-red)]">joining.</span>
            </h2>
            <p className="lp-sans mx-auto mt-4 max-w-[52ch] text-[1rem] leading-[1.6] text-[var(--lp-ink)]/82">
              USA Gummies members get priority access and premium perks that reward loyal buyers of
              our All American gummy bears.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {BENEFITS.map((benefit, i) => (
              <div
                key={benefit.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)]">
                  {benefit.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {benefit.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-7 sm:p-8"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <p className="lp-label text-[var(--lp-red)]">★ Member Portal ★</p>
            <h2 className="lp-display mt-3 text-[1.8rem] leading-tight text-[var(--lp-ink)] sm:text-[2.2rem]">
              Member access launches after your first purchase.
            </h2>
            <p className="lp-sans mt-4 text-[1rem] leading-[1.65] text-[var(--lp-ink)]/85">
              Place your first order and you are in. We will email your sign-in link as soon as the
              Revolution portal is live.
            </p>

            <div className="mt-6 border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] p-5">
              <p className="lp-label text-[var(--lp-ink)]">★ What members get ★</p>
              <ul className="lp-sans mt-3 space-y-2 text-[0.95rem] text-[var(--lp-ink)]/85">
                <li className="flex gap-2">
                  <span className="text-[var(--lp-red)]">★</span>
                  <span>Order history tied to your checkout email</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[var(--lp-red)]">★</span>
                  <span>Subscription eligibility after your first order</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[var(--lp-red)]">★</span>
                  <span>Early drops and premium savings alerts</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/shop" className="lp-cta">
                Shop now
              </Link>
              <Link href="/faq" className="lp-cta lp-cta-light">
                Read the FAQ
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ A Vote for America ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            All natural.
            <br />
            <span className="lp-script text-[var(--lp-red)]">All American.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
            </Link>
            <Link href="/about" className="lp-cta lp-cta-light">
              Our story
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
