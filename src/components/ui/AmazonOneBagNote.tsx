import Image from "next/image";
import { AMAZON_LISTING_URL, AMAZON_LOGO_URL } from "@/lib/amazon";

export function AmazonOneBagNote({
  className = "",
  linkClassName = "",
}: {
  className?: string;
  linkClassName?: string;
}) {
  const baseClass = ["text-xs font-semibold text-[var(--muted)]", className]
    .filter(Boolean)
    .join(" ");
  const linkClass = [
    "inline-flex items-center gap-2 underline underline-offset-4 text-[var(--text)] hover:text-[var(--navy)]",
    linkClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={baseClass}>
      Buying 1-4 bags?{" "}
      <a href={AMAZON_LISTING_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <Image
          src={AMAZON_LOGO_URL}
          alt="Amazon"
          width={56}
          height={16}
          className="h-3.5 w-auto opacity-85"
        />
        <span>Buy on Amazon</span>
      </a>
      .
    </div>
  );
}
