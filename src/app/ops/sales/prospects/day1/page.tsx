import type { Metadata } from "next";

import { Day1ProspectsView } from "./Day1ProspectsView.client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Day 1 Prospects · USA Gummies Ops",
};

export default function Day1ProspectsPage() {
  return <Day1ProspectsView />;
}
