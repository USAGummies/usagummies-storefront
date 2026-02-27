import type { Metadata } from "next";
import { ChannelView } from "./ChannelView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Channel Intelligence" };

export default function ChannelsPage() {
  return <ChannelView />;
}
