import type { Metadata } from "next";
import { SalesSheet } from "./SalesSheet";

export const metadata: Metadata = {
  title: "Sales Sheet | USA Gummies",
  description: "USA Gummies wholesale sales sheet with QR code for trade show orders.",
  robots: { index: false, follow: false },
};

export default function SalesSheetPage() {
  return <SalesSheet />;
}
