import { AMAZON_LISTING_URL } from "@/lib/amazon";

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
    "underline underline-offset-4 text-[var(--text)] hover:text-[var(--navy)]",
    linkClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={baseClass}>
      Want to try 1 bag?{" "}
      <a href={AMAZON_LISTING_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
        Buy on Amazon
      </a>
      .
    </div>
  );
}
