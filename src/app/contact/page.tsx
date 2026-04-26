import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/forms/ContactForm";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { PageHero } from "@/components/lp/PageHero";

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
const PAGE_TITLE = "Contact USA Gummies";
const PAGE_DESCRIPTION =
  "Need help with made in USA candy orders or dye-free gummies? Contact USA Gummies for support, wholesale, or press.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/contact` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/contact`,
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

const HELP_TILES = [
  {
    title: "Fast response",
    copy: "We reply within one business day on weekdays.",
  },
  {
    title: "Order help",
    copy: "Include your order number for faster support.",
  },
  {
    title: "Shipping & guarantee",
    copy: "See our policies for timing and how we make it right.",
    link: "/policies",
  },
];

const TOPICS = [
  "Order questions",
  "Shipping & delivery",
  "Damaged or incorrect items",
  "Wholesale / partnerships",
];

export default function ContactPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Contact", href: "/contact" },
        ]}
      />

      <PageHero
        eyebrow="Contact"
        headline="Talk to"
        scriptAccent="us."
        sub="Customer support or business inquiries — we reply within one business day."
      />

      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {HELP_TILES.map((item, i) => (
              <div
                key={item.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {item.copy}{" "}
                  {item.link ? (
                    <Link
                      href={item.link}
                      className="text-[var(--lp-red)] underline underline-offset-4"
                    >
                      View policies
                    </Link>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Send a Message ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
              How can we
              <br />
              <span className="lp-script text-[var(--lp-red)]">help?</span>
            </h2>
            <ul className="lp-sans mx-auto mt-6 grid max-w-[480px] grid-cols-2 gap-x-6 gap-y-2 text-left text-[0.95rem] text-[var(--lp-ink)]/82">
              {TOPICS.map((topic) => (
                <li key={topic} className="flex items-start gap-2">
                  <span className="text-[var(--lp-red)]">★</span>
                  <span>{topic}</span>
                </li>
              ))}
            </ul>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <ContactForm context="Contact Page" />
          </div>
        </div>
      </section>

      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Looking to Order? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            Shop all-natural
            <br />
            <span className="lp-script text-[var(--lp-red)]">USA Gummies.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
            </Link>
            <Link href="/help" className="lp-cta lp-cta-light">
              Help center
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
