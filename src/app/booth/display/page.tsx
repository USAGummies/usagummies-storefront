import type { Metadata } from "next";
import { BoothDisplay } from "./BoothDisplay";

export const metadata: Metadata = {
  title: "USA Gummies — Trade Show Display",
  robots: { index: false, follow: false },
};

export default function BoothDisplayPage() {
  return <BoothDisplay />;
}
