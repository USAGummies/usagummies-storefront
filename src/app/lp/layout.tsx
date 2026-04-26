// /lp/* — paid-traffic landing pages. The brand styling (LP tokens,
// classes, fonts) is now applied site-wide via the AppShell `.lp-scope`
// wrapper + global `lp.css` import in the root layout, so this layout is
// just a metadata pass-through.
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#CF2932",
  colorScheme: "light",
};

export default function LpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
