"use client";

import { useEffect, useRef } from "react";
import { trackViewContent } from "@/lib/analytics";

type Props = {
  productId: string;
  productName: string;
  price: number;
  currency?: string;
};

export default function ProductViewTracker({ productId, productName, price, currency }: Props) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackViewContent({ id: productId, name: productName, price, currency });
  }, [productId, productName, price, currency]);

  return null;
}
