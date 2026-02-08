// src/components/product/LazyStickyAddToCartBar.client.tsx
"use client";

import dynamic from "next/dynamic";

const StickyAddToCartBar = dynamic(
  () => import("./StickyAddToCartBar").then((mod) => mod.StickyAddToCartBar),
  { ssr: false }
);

type Props = {
  title: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  buttonLabel?: string;
  source?: "home" | "shop";
  className?: string;
  containerClassName?: string;
};

export function LazyStickyAddToCartBar(props: Props) {
  return <StickyAddToCartBar {...props} />;
}
