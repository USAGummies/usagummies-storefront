import type { Metadata } from "next";

import { LoginForm } from "./LoginForm.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in · USA Gummies",
  description: "Sign in to your USA Gummies account.",
  robots: { index: false, follow: false },
};

export default function AccountLoginPage() {
  return (
    <main className="max-w-md mx-auto px-6 py-16 text-[#0a1e3d]">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        USA Gummies · Account
      </div>
      <h1 className="text-3xl font-bold mb-2">Sign in</h1>
      <p className="text-sm text-gray-600 mb-8">
        Use the email + password from your last USA Gummies order.{" "}
        <a href="/account/recover" className="text-[#b22234] underline">
          Forgot your password?
        </a>
      </p>
      <LoginForm />
    </main>
  );
}
