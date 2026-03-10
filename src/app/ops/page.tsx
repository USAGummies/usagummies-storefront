import type { Metadata } from "next";
import { CommandCenter } from "./CommandCenter.client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Command Center",
};

export default function OpsHomePage() {
  return <CommandCenter />;
}
