import type { Metadata } from "next";
import ReviewFlow from "./ReviewFlow.client";

export const metadata: Metadata = {
  title: "Spin & Win | USA Gummies VIP Rewards",
  description:
    "Share your USA Gummies experience and spin the wheel for an exclusive reward. Every spin wins!",
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return <ReviewFlow />;
}
