import type { Metadata } from "next";

import { RecoverForm } from "./RecoverForm.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Recover password · USA Gummies",
  description: "Send a password reset email for your USA Gummies account.",
  robots: { index: false, follow: false },
};

export default function AccountRecoverPage() {
  return (
    <main className="max-w-md mx-auto px-6 py-16 text-[#0a1e3d]">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        USA Gummies · Account
      </div>
      <h1 className="text-3xl font-bold mb-2">Reset your password</h1>
      <p className="text-sm text-gray-600 mb-8">
        Enter the email on your account and we&apos;ll send a reset link from
        Shopify.{" "}
        <a href="/account/login" className="text-[#b22234] underline">
          Back to sign in
        </a>
      </p>
      <RecoverForm />
    </main>
  );
}
