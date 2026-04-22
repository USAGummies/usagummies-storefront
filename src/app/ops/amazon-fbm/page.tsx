import type { Metadata } from "next";

import { AmazonFbmView } from "./AmazonFbmView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Amazon FBM Queue",
};

export default function AmazonFbmPage() {
  return <AmazonFbmView />;
}
