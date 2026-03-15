import type { Metadata } from "next";
import { DraftsView } from "./DraftsView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Draft Emails",
};

export default function DraftsPage() {
  return <DraftsView />;
}
