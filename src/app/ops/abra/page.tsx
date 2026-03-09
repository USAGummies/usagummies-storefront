import type { Metadata } from "next";
import { AbraChat } from "./AbraChat.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Abra",
};

export default function AbraPage() {
  return <AbraChat />;
}

