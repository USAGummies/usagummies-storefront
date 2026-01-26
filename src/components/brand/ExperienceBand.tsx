"use client";

import Link from "next/link";
import Image from "next/image";
import { GummyIconRow } from "@/components/ui/GummyIcon";

type Props = {
  variant?: "full" | "compact";
  className?: string;
};

export function ExperienceBand({ variant = "compact", className }: Props) {
  const isFull = variant === "full";

  return (
    <section
      className={[
        "experience-band",
        isFull ? "experience-band--full" : "experience-band--compact",
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Image
        src="/website%20assets/B17Bomber.png"
        alt=""
        aria-hidden="true"
        width={1405}
        height={954}
        sizes="(max-width: 768px) 1px, 420px"
        className="experience-band__accent"
      />
      <div className="experience-band__trail" aria-hidden="true">
        <GummyIconRow size={12} className="opacity-90" />
      </div>
      <Image
        src="/website%20assets/StatueofLiberty.png"
        alt=""
        aria-hidden="true"
        width={780}
        height={1024}
        sizes="(max-width: 768px) 1px, 260px"
        className="experience-band__liberty"
      />

      <div className="experience-band__inner">
        <div className="experience-band__header">
          <div className="experience-band__eyebrow">The USA Gummies way</div>
          <div className="experience-band__title">
            Premium American gummies, built for sharing.
          </div>
          <div className="experience-band__sub">
            Made in the USA. All natural flavors. No artificial dyes.
          </div>
        </div>

        <div className="experience-band__grid">
          <div className="experience-band__card">
            <div className="experience-band__cardEyebrow">Gifting</div>
            <div className="experience-band__cardTitle">Gift-ready bundles</div>
            <div className="experience-band__cardCopy">
              Care packages, celebrations, and patriotic moments.
            </div>
            <Link href="/gummy-gift-bundles" className="experience-band__link">
              Explore gift bundles
            </Link>
          </div>

          <div className="experience-band__card">
            <div className="experience-band__cardEyebrow">Rewards</div>
            <div className="experience-band__cardTitle">Early access + member perks</div>
            <div className="experience-band__cardCopy">
              Join the Revolution for drops, exclusives, and savings.
            </div>
            <Link href="/join-the-revolution" className="experience-band__link">
              Join the Revolution
            </Link>
          </div>

          <div className="experience-band__card">
            <div className="experience-band__cardEyebrow">Flavors</div>
            <div className="experience-band__cardTitle">Classic fruit lineup</div>
            <div className="experience-band__cardCopy">
              Five classic flavors with natural color from fruit + vegetable extracts.
            </div>
            <div className="experience-band__gummyRow" aria-hidden="true">
              <GummyIconRow size={14} className="opacity-80" />
            </div>
            <Link href="/ingredients" className="experience-band__link">
              See ingredients
            </Link>
          </div>

          <div className="experience-band__card">
            <div className="experience-band__cardEyebrow">Made in USA</div>
            <div className="experience-band__cardTitle">American-made proof</div>
            <div className="experience-band__cardCopy">
              Packed in FDA-compliant facilities with full U.S. sourcing.
            </div>
            <Link href="/made-in-usa" className="experience-band__link">
              See our process
            </Link>
          </div>
        </div>

        <div className="experience-band__footer">
          Ships within 24 hours • Easy returns • Secure checkout
        </div>
      </div>
    </section>
  );
}
