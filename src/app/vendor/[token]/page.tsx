/**
 * Public vendor portal page — Phase 31.2.b.
 *
 * Renders the COI upload form for a registered vendor whose HMAC-
 * signed token is valid + not expired.
 *
 * **Public** — NOT under /ops/, no NextAuth required. Token in
 * the URL path is the auth gate.
 *
 * Server component:
 *   1. Verify the token via the HMAC primitive.
 *   2. Look up the vendor in VENDOR_PORTAL_REGISTRY.
 *   3. If both pass + the vendor has a coiDriveFolderId → render
 *      the upload form.
 *   4. Otherwise → render a clear error (expired / invalid /
 *      vendor missing / destination unconfigured) without
 *      leaking which check failed (defense against probing).
 */
import type { Metadata } from "next";

import { getVendorPortalEntry } from "@/lib/ops/vendor-portal-registry";
import { verifyVendorPortalToken } from "@/lib/ops/vendor-portal-token";

import { CoiUploadForm } from "./CoiUploadForm.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Vendor Portal — USA Gummies",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function VendorPortalPage({ params }: PageProps) {
  const { token } = await params;
  const secret = process.env.VENDOR_PORTAL_SECRET?.trim();

  const verify = verifyVendorPortalToken(token, secret ?? null, new Date());

  if (!verify.ok) {
    const expired = verify.reason === "expired";
    return (
      <ErrorScreen
        title={expired ? "Link expired" : "Invalid link"}
        body={
          expired
            ? "This portal link has expired. Request a fresh one from your USA Gummies AP rep."
            : "This portal link isn't valid. If you believe this is an error, contact your USA Gummies AP rep."
        }
      />
    );
  }

  const vendorId = verify.vendorId!;
  const entry = getVendorPortalEntry(vendorId);
  if (!entry) {
    return (
      <ErrorScreen
        title="Vendor not found"
        body="Your vendor record isn't currently configured for the portal. Contact your USA Gummies AP rep."
      />
    );
  }
  if (!entry.coiDriveFolderId) {
    return (
      <ErrorScreen
        title="Upload destination not configured"
        body="The upload destination for your vendor is not yet set up. Contact your USA Gummies AP rep so we can finish onboarding."
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8f5ef",
        padding: "48px 24px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "#ffffff",
          border: "1px solid rgba(27,42,74,0.08)",
          borderRadius: 12,
          padding: "32px 28px",
          boxShadow: "0 1px 3px rgba(27,42,74,0.06)",
        }}
      >
        <header style={{ marginBottom: 20 }}>
          <div
            style={{
              color: "rgba(27,42,74,0.56)",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            USA Gummies — Vendor Portal
          </div>
          <h1
            style={{
              margin: "8px 0 0 0",
              color: "#1B2A4A",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: -0.5,
            }}
          >
            {entry.displayName}
          </h1>
          <p
            style={{
              margin: "10px 0 0 0",
              color: "rgba(27,42,74,0.72)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Upload your renewed Certificate of Insurance below. Accepted: PDF,
            PNG, JPG, DOC, up to 10 MB. Once uploaded, your COI is filed
            directly to our records — no follow-up email needed.
          </p>
        </header>

        <CoiUploadForm token={token} vendorDisplayName={entry.displayName} />

        <footer
          style={{
            marginTop: 28,
            color: "rgba(27,42,74,0.45)",
            fontSize: 12,
            borderTop: "1px solid rgba(27,42,74,0.08)",
            paddingTop: 12,
          }}
        >
          This link is single-purpose and expires automatically. If you have
          trouble, contact your USA Gummies AP rep.
        </footer>
      </div>
    </div>
  );
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8f5ef",
        padding: "48px 24px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 540,
          margin: "0 auto",
          background: "#ffffff",
          border: "1px solid rgba(27,42,74,0.08)",
          borderRadius: 12,
          padding: "32px 28px",
        }}
      >
        <h1
          style={{
            margin: 0,
            color: "#1B2A4A",
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: "12px 0 0 0",
            color: "rgba(27,42,74,0.72)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}
