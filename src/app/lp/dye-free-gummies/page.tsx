import type { Metadata } from "next";
import { HeroSection } from "@/components/lp/HeroSection";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { BombsAway } from "@/components/lp/BombsAway";
import { FoundersLetter } from "@/components/lp/FoundersLetter";
import { ReviewsStrip } from "@/components/lp/ReviewsStrip";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { FaqAccordion } from "@/components/lp/FaqAccordion";
import { StickyBuyBar } from "@/components/lp/StickyBuyBar";
import { FooterMini } from "@/components/lp/FooterMini";

export const metadata: Metadata = {
  title: "Dye-Free Gummy Bears — Made in USA | USA Gummies",
  description:
    "Real gummy bears. No artificial dyes. Colored by fruit. Pressed in Spokane, Washington. Ships in 24 hours with a 30-day money-back guarantee.",
  openGraph: {
    title: "Real Gummy Bears. No Red 40.",
    description:
      "Dye-free gummy bears pressed in America. Colored by fruit. Ships in 24 hrs.",
    url: "https://www.usagummies.com/lp/dye-free-gummies",
    images: [
      {
        url: "/brand/americana/bag-dramatic-smoke.jpg",
        width: 1200,
        height: 1200,
        alt: "USA Gummies bag on a cream background",
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
      <ReviewsStrip />
      <GuaranteeBlock />
      <FaqAccordion />
      <FooterMini />
      <StickyBuyBar />
    </main>
  );
}
