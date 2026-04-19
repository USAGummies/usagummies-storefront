import type { Metadata } from "next";
import { OrdersView } from "./OrdersView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Orders Queue",
};

export default function OrdersPage() {
  return <OrdersView />;
}
