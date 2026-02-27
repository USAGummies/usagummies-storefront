import type { Metadata } from "next";
import { ChannelView } from "./ChannelView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revenue by Channel" };

export default function ChannelsPage() {
  return <ChannelView />;
}
