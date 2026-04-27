import type { Metadata } from "next";

import { StackReadinessView } from "./StackReadinessView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Stack Readiness",
};

export default function StackReadinessPage() {
  return <StackReadinessView />;
}
