// /lp/* — scoped layout for paid-traffic landing pages.
// Fonts flow from the root layout (Anton / Inter / Allison — canonical
// brand stack). The LP scope keeps its own CSS so layout components can
// rely on the LP-specific tokens (--lp-ink, --lp-red, --lp-cream).
import type { Metadata, Viewport } from "next";
import "@/styles/lp.css";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#CF2932",
  colorScheme: "light",
};

export default function LpLayout({ children }: { children: React.ReactNode }) {
  return <div className="lp-scope">{children}</div>;
}
