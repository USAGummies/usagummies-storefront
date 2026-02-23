import type { Metadata } from "next";
import CommandCenterShell from "./CommandCenterShell.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Agentic Command Center",
  description: "Operational dashboard for USA Gummies outreach automation and self-heal monitoring.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CommandCenterPage() {
  return <CommandCenterShell />;
}
