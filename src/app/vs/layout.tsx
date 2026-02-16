// src/app/vs/layout.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function VsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
