import type { Metadata } from "next";

import { AmazonCustomersView } from "./AmazonCustomersView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Amazon Customers",
};

export default function AmazonCustomersPage() {
  return <AmazonCustomersView />;
}
