import "server-only";

export interface BundleVariant {
  quantity: number;
  perBagPrice: number;
  totalPrice: number;
  freeShipping: boolean;
}

export function getBundleVariants(): BundleVariant[] {
  const basePrice = 5.99;
  const minPrice = 4.25;
  const maxQty = 12;
  const variants: BundleVariant[] = [];
  const round = (n: number): number => Math.round(n * 100) / 100;
  const discountSteps = maxQty - 3;
  const stepSize = (basePrice - minPrice) / discountSteps;

  for (let qty = 1; qty <= maxQty; qty++) {
    let perBag: number;
    if (qty <= 3) {
      perBag = basePrice;
    } else if (qty < maxQty) {
      const rawPrice = basePrice - stepSize * (qty - 3);
      perBag = Math.max(rawPrice, minPrice + Number.EPSILON);
    } else {
      perBag = minPrice;
    }
    perBag = round(perBag);
    const total = round(perBag * qty);
    variants.push({
      quantity: qty,
      perBagPrice: perBag,
      totalPrice: total,
      freeShipping: qty >= 5,
    });
  }

  return variants;
}

export function getRecommendedVariant(): BundleVariant {
  const variants = getBundleVariants();
  return variants.find(v => v.quantity === 8)!;
}
