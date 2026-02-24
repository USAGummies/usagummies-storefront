import type { Metadata } from "next";
import { LogsView } from "./LogsView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Logs",
};

export default function LogsPage() {
  return <LogsView />;
}
