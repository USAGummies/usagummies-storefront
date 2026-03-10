import type { Metadata } from "next";
import { DigestView } from "./DigestView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Weekly Digest" };

export default function DigestPage() {
  return <DigestView />;
}
