import type { Metadata } from "next";
import { PermissionsView } from "./PermissionsView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Permission Queue",
};

export default function PermissionsPage() {
  return <PermissionsView />;
}
