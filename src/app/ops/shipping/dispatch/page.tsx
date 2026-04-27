import type { Metadata } from "next";

import { DispatchBoardView } from "./DispatchBoardView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Dispatch Board",
};

export default function DispatchBoardPage() {
  return <DispatchBoardView />;
}
