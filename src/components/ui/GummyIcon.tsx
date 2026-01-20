import Image from "next/image";
import { cn } from "@/lib/cn";

const GUMMY_SOURCES = {
  red: "/brand/gummies/gummy-red.png",
  orange: "/brand/gummies/gummy-orange.png",
  yellow: "/brand/gummies/gummy-yellow.png",
  green: "/brand/gummies/gummy-green.png",
  pink: "/brand/gummies/gummy-pink.png",
} as const;

const GUMMY_VARIANTS = Object.keys(GUMMY_SOURCES) as Array<keyof typeof GUMMY_SOURCES>;

const GUMMY_ROTATIONS = [-8, 6, -4, 7, -5];
const HERO_PACK_SRC = "/brand/hero-pack-icon.png";

type GummyVariant = keyof typeof GUMMY_SOURCES;

type GummyIconProps = {
  variant?: GummyVariant;
  size?: number;
  className?: string;
  alt?: string;
  rotate?: number;
};

export function GummyIcon({
  variant = "red",
  size = 18,
  className,
  alt = "",
  rotate,
}: GummyIconProps) {
  const rotation =
    typeof rotate === "number" ? rotate : GUMMY_ROTATIONS[GUMMY_VARIANTS.indexOf(variant) % 5];
  return (
    <span
      className={cn("inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden={alt === ""}
    >
      <span style={{ display: "inline-flex", transform: `rotate(${rotation}deg)` }}>
        <Image
          src={GUMMY_SOURCES[variant]}
          alt={alt}
          width={size}
          height={size}
          className="object-contain"
        />
      </span>
    </span>
  );
}

type HeroPackIconProps = {
  size?: number;
  className?: string;
  alt?: string;
  rotate?: number;
};

export function HeroPackIcon({
  size = 24,
  className,
  alt = "",
  rotate = -4,
}: HeroPackIconProps) {
  return (
    <span
      className={cn("inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden={alt === ""}
    >
      <span style={{ display: "inline-flex", transform: `rotate(${rotate}deg)` }}>
        <Image
          src={HERO_PACK_SRC}
          alt={alt}
          width={size}
          height={size}
          className="object-contain"
        />
      </span>
    </span>
  );
}

type GummyIconRowProps = {
  variants?: GummyVariant[];
  size?: number;
  className?: string;
};

export function GummyIconRow({
  variants = GUMMY_VARIANTS,
  size = 18,
  className,
}: GummyIconRowProps) {
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)} aria-hidden="true">
      {variants.map((variant, idx) => (
        <GummyIcon key={`${variant}-${idx}`} variant={variant} size={size} />
      ))}
    </div>
  );
}
