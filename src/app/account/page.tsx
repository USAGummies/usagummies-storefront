import type { Metadata } from "next";

import { AccountView } from "./AccountView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your account · USA Gummies",
  description: "Your USA Gummies orders, subscriptions, and B2B status.",
  robots: { index: false, follow: false },
};

/**
 * /account — customer-facing account dashboard.
 *
 * Server-side is a thin shell. The client view fetches
 * /api/member?action=session, redirects to /account/login on 401, and
 * renders orders + (when applicable) a read-only B2B status panel.
 *
 * The page never displays per-account pricing, custom terms, or the
 * checkout/cart. Reorder is intentionally not built yet — see Phase 3
 * for that work.
 */
export default function AccountPage() {
  return <AccountView />;
}
