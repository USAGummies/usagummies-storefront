import type { Metadata } from "next";
import { HeroSection } from "@/components/lp/HeroSection";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { BombsAway } from "@/components/lp/BombsAway";
import { FoundersLetter } from "@/components/lp/FoundersLetter";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { FaqAccordion } from "@/components/lp/FaqAccordion";
import { StickyBuyBar } from "@/components/lp/StickyBuyBar";
import { FooterMini } from "@/components/lp/FooterMini";

export const metadata: Metadata = {
  title: "Dye-Free Gummy Bears — Made in U.S.A. | USA Gummies",
  description:
    "Real gummy bears, sourced, made, and packed in the U.S.A. Five natural flavors. No artificial dyes. 30-day satisfaction guarantee.",
  openGraph: {
    title: "USA Gummies — Dye-Free Gummy Bears, Made in the U.S.A.",
    description:
      "Five natural flavors. No artificial dyes. Sourced, made, and packed in the U.S.A.",
    url: "https://www.usagummies.com/lp/dye-free-gummies",
    images: [
      {
        url: "/brand/americana/bag-dramatic-smoke.jpg",
        width: 1200,
        height: 1200,
        alt: "USA Gummies — All American Gummy Bears",
      },
    ],
  },
};

export default function DyeFreeGummiesLandingPage() {
  return (
    <main>
      <HeroSection />
      <ScarcityBar />
      <ThreePromises />
      <BombsAway />
      <FoundersLetter />
      <GuaranteeBlock />
      <FaqAccordion />
      <FooterMini />
      <StickyBuyBar />
    </main>
  );
}
