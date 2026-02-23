import type { Metadata } from "next";
import { OpsShell } from "./OpsShell.client";

export const metadata: Metadata = {
  title: {
    default: "Ops | USA Gummies",
    template: "%s | USA Gummies Ops",
  },
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <OpsShell>{children}</OpsShell>;
}
