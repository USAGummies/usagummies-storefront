\"use client\";

type BrandTouchZone =
  | "HERO"
  | "PRICING"
  | "BUNDLE"
  | "REVIEWS"
  | "BENEFITS"
  | "STORY"
  | "EMAIL";

type BrandTouchId =
  | "b17"
  | "train"
  | "jeep"
  | "shuttle"
  | "rushmore"
  | "liberty"
  | "iwajima";

const BRAND_TOUCHES: Record<
  BrandTouchId,
  {
    src: string;
    width: number;
    height: number;
    role: string;
    allowedZones: BrandTouchZone[];
  }
> = {
  b17: {
    src: "/brand/website%20assets/B17Bomber.png",
    width: 1405,
    height: 954,
    role: "motion",
    allowedZones: ["BUNDLE"],
  },
  train: {
    src: "/brand/website%20assets/Train-02.png",
    width: 5013,
    height: 2212,
    role: "divider",
    allowedZones: ["REVIEWS", "EMAIL"],
  },
  jeep: {
    src: "/brand/website%20assets/Jeep.png",
    width: 1041,
    height: 701,
    role: "supporting",
    allowedZones: ["BENEFITS"],
  },
  shuttle: {
    src: "/brand/website%20assets/SpaceShuttle.png",
    width: 354,
    height: 1441,
    role: "upgrade",
    allowedZones: ["BUNDLE"],
  },
  rushmore: {
    src: "/brand/website%20assets/MtRushmore.png",
    width: 1398,
    height: 857,
    role: "credibility",
    allowedZones: ["REVIEWS"],
  },
  liberty: {
    src: "/brand/website%20assets/StatueofLiberty.png",
    width: 567,
    height: 1475,
    role: "seal",
    allowedZones: ["HERO"],
  },
  iwajima: {
    src: "/brand/website%20assets/IwaJima.png",
    width: 1199,
    height: 1324,
    role: "manifesto",
    allowedZones: ["STORY"],
  },
};

type BrandTouchProps = {
  id: BrandTouchId;
  zone: BrandTouchZone;
  className?: string;
};

export function BrandTouch({ id, zone, className }: BrandTouchProps) {
  const asset = BRAND_TOUCHES[id];
  if (!asset.allowedZones.includes(zone)) return null;

  return (
    <img
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      data-role={asset.role}
      data-zone={zone}
      className={["brand-touch", className].filter(Boolean).join(" ")}
    />
  );
}
