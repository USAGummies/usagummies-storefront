import type { Metadata } from "next";
import { InboxView } from "./InboxView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Inbox",
};

export default function InboxPage() {
  return <InboxView />;
}
