import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { verifyInquiryToken } from "@/lib/wholesale/inquiry-token";

import { InquiryReceiptView } from "./InquiryReceiptView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your wholesale inquiry · USA Gummies",
  description:
    "Bookmarkable receipt page for your USA Gummies wholesale inquiry. Track status and upload requested documents.",
  robots: { index: false, follow: false },
};

/**
 * /wholesale/inquiry/[token]
 *
 * Server-side: verify the HMAC token. On success, hand the verified
 * email + metadata to the client view, which fetches live status from
 * the existing `/api/wholesale-status` endpoint and shows a doc-upload
 * widget that POSTs to `/api/ops/upload`.
 *
 * On expired token → 410 page (handled here as a static fallback so
 * SEO never indexes a "your inquiry expired" page anyway). On bad
 * signature → 404. On missing secret → 503-equivalent generic error.
 */
export default async function WholesaleInquiryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = verifyInquiryToken(token);
  if (!result.ok) {
    if (result.code === "expired") {
      return (
        <main className="max-w-xl mx-auto px-6 py-16">
          <h1 className="text-2xl font-bold text-[#0a1e3d] mb-3">
            This inquiry link expired
          </h1>
          <p className="text-sm text-gray-600">
            For security, wholesale inquiry links are valid for 30 days. Submit
            a new inquiry at{" "}
            <a href="/wholesale" className="text-[#b22234] underline">
              /wholesale
            </a>{" "}
            and we&apos;ll send you a fresh link.
          </p>
        </main>
      );
    }
    if (result.code === "secret_not_configured") {
      return (
        <main className="max-w-xl mx-auto px-6 py-16">
          <h1 className="text-2xl font-bold text-[#0a1e3d] mb-3">
            Wholesale receipt is temporarily unavailable
          </h1>
          <p className="text-sm text-gray-600">
            Our team has been notified. Email{" "}
            <a href="mailto:ben@usagummies.com" className="text-[#b22234] underline">
              ben@usagummies.com
            </a>{" "}
            and we&apos;ll respond directly.
          </p>
        </main>
      );
    }
    notFound();
  }

  return (
    <InquiryReceiptView
      email={result.payload.e}
      source={result.payload.i}
      createdAt={new Date(result.payload.c * 1000).toISOString()}
      ageDays={Math.floor(result.ageSeconds / (24 * 3600))}
    />
  );
}
