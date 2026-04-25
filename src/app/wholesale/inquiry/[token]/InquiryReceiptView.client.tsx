"use client";

import { useEffect, useRef, useState } from "react";

interface Deal {
  id: string;
  name: string;
  amount: string;
  stage: string;
  stageLabel: string;
  paymentMethod: string;
  onboardingComplete: boolean;
  paymentReceived: boolean;
  onboardingUrl: string;
}

interface StatusResponse {
  ok: boolean;
  email: string;
  contact?: { firstname: string; company: string };
  deals: Deal[];
  message?: string;
  error?: string;
}

type DocType = "ncs" | "w9" | "coi" | "vendor-form" | "other";

const DOC_TYPE_LABELS: Record<DocType, string> = {
  ncs: "New Customer Setup (NCS-001)",
  w9: "W-9",
  coi: "Certificate of Insurance",
  "vendor-form": "Vendor setup form",
  other: "Something else",
};

interface UploadResultOk {
  ok: true;
  fileId: string;
  name: string;
  webViewLink: string | null;
}
interface UploadResultErr {
  ok: false;
  error: string;
  code?: string;
}

export function InquiryReceiptView(props: {
  email: string;
  source: string;
  createdAt: string;
  ageDays: number;
}) {
  // ---- Live status panel ------------------------------------------------
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatusLoading(true);
      try {
        const res = await fetch(
          `/api/wholesale-status?email=${encodeURIComponent(props.email)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setStatusErr(body.error || `HTTP ${res.status}`);
          setStatus(null);
        } else {
          setStatus(body);
          setStatusErr(null);
        }
      } catch (err) {
        if (!cancelled)
          setStatusErr(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.email]);

  // ---- Doc upload widget ------------------------------------------------
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<DocType>("ncs");
  const [fileName, setFileName] = useState("");
  const [uploadState, setUploadState] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadResult, setUploadResult] = useState<
    UploadResultOk | UploadResultErr | null
  >(null);

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadState("error");
      setUploadResult({ ok: false, error: "Pick a file first." });
      return;
    }
    setUploadState("uploading");
    setUploadResult(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("submitter", props.email);
    fd.append("doc_type", docType);
    fd.append(
      "notes",
      `Submitted via wholesale inquiry receipt for ${props.email} (source: ${props.source}, age ${props.ageDays}d).`,
    );

    try {
      const res = await fetch("/api/ops/upload", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok || body.ok !== true) {
        setUploadResult({
          ok: false,
          error: String(body.error ?? `HTTP ${res.status}`),
          code: typeof body.code === "string" ? body.code : undefined,
        });
        setUploadState("error");
        return;
      }
      setUploadResult({
        ok: true,
        fileId: String(body.fileId ?? ""),
        name: String(body.name ?? file.name),
        webViewLink:
          typeof body.webViewLink === "string" ? body.webViewLink : null,
      });
      setUploadState("success");
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setUploadResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      setUploadState("error");
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-[#0a1e3d]">
      <header className="mb-8">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          Wholesale Inquiry · USA Gummies
        </div>
        <h1 className="text-3xl font-bold mt-1">
          Hi — your inquiry is on file
        </h1>
        <p className="text-sm text-gray-600 mt-2">
          We received your wholesale request for{" "}
          <span className="font-semibold">{props.email}</span> on{" "}
          <span className="font-semibold">
            {new Date(props.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          . Bookmark this page — it&apos;s your sticky receipt and where
          we&apos;ll ask you to upload any vendor / setup forms we need.
        </p>
        <p className="text-xs text-gray-400 mt-2">
          The link is signed and tied to your inquiry; it expires 30 days after
          submission for security. Submit again at{" "}
          <a href="/wholesale" className="underline">
            /wholesale
          </a>{" "}
          for a fresh link if needed.
        </p>
      </header>

      {/* ---------- Status panel ---------- */}
      <section className="bg-white rounded-2xl shadow-md p-6 mb-6">
        <div className="text-sm font-bold uppercase tracking-wide text-[#b22234] mb-3">
          Status
        </div>
        {statusLoading ? (
          <p className="text-sm text-gray-500">Loading deal status…</p>
        ) : statusErr ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            Status lookup failed: {statusErr}. This doesn&apos;t mean your
            inquiry is lost — it just means our pipeline lookup is temporarily
            unavailable. Email ben@usagummies.com if you need an answer fast.
          </div>
        ) : status && status.deals.length > 0 ? (
          <div className="space-y-3">
            {status.deals.map((d) => (
              <DealCard key={d.id} deal={d} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-600">
            <p>
              Your request is queued. Our team typically responds within 1
              business day with pricing, MOQs, and next steps.
              {status?.message ? ` (${status.message})` : ""}
            </p>
            <p className="mt-2">
              Once a deal opens for your account, this section will show stage,
              payment, onboarding, and shipping status in one place.
            </p>
          </div>
        )}
      </section>

      {/* ---------- Doc upload ---------- */}
      <section className="bg-white rounded-2xl shadow-md p-6">
        <div className="text-sm font-bold uppercase tracking-wide text-[#b22234] mb-3">
          Send us a document
        </div>
        <p className="text-sm text-gray-600 mb-4">
          If we&apos;ve asked you to send a vendor setup form, W-9, COI, or
          another file, upload it here. The file goes straight into our secure
          internal Drive and our team gets a notification — no email back-and-
          forth needed.
        </p>

        <form onSubmit={submitUpload} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Document type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
            >
              {(Object.keys(DOC_TYPE_LABELS) as DocType[]).map((k) => (
                <option key={k} value={k}>
                  {DOC_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              File (PDF / PNG / JPG / Word, max 10 MB)
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-5 text-center cursor-pointer hover:border-[#b22234] hover:bg-red-50/30 transition-colors"
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx"
                className="hidden"
                onChange={(e) =>
                  setFileName(e.target.files?.[0]?.name ?? "")
                }
              />
              {fileName ? (
                <p className="text-sm font-medium">{fileName}</p>
              ) : (
                <p className="text-sm text-gray-500">
                  Click to choose a file
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={uploadState === "uploading"}
            className="w-full bg-[#b22234] hover:bg-[#8b1a29] disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-lg text-sm transition-colors"
          >
            {uploadState === "uploading" ? "Uploading…" : "Upload"}
          </button>

          {uploadState === "success" && uploadResult && uploadResult.ok && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
              Got it. {uploadResult.name} is on file.{" "}
              {uploadResult.webViewLink ? (
                <a
                  href={uploadResult.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  View it on Drive
                </a>
              ) : null}
            </div>
          )}
          {uploadState === "error" && uploadResult && !uploadResult.ok && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
              {uploadResult.code === "drive_not_configured" ||
              uploadResult.code === "drive_oauth_missing" ? (
                <>
                  Upload is temporarily unavailable — our team has been
                  notified. If this is urgent, reply to ben@usagummies.com with
                  the file attached.
                </>
              ) : (
                <>Upload failed: {uploadResult.error}</>
              )}
            </div>
          )}
        </form>
      </section>

      <footer className="mt-10 text-center text-xs text-gray-400">
        Questions? Email{" "}
        <a href="mailto:ben@usagummies.com" className="underline">
          ben@usagummies.com
        </a>
      </footer>
    </main>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const amountNum = Number(deal.amount) || 0;
  const isPayNow = deal.paymentMethod === "pay_now";
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
        <div>
          <div className="font-semibold text-sm">{deal.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {deal.stageLabel} · {isPayNow ? "Paid by card" : "Invoice / Net 10"}
          </div>
        </div>
        <div className="text-sm font-bold">${amountNum.toFixed(2)}</div>
      </div>
      <div className="px-4 py-3 text-xs space-y-1">
        <Row
          label="Payment"
          done={deal.paymentReceived}
          detail={deal.paymentReceived ? "Received" : "Not yet"}
        />
        <Row
          label="Customer info"
          done={deal.onboardingComplete}
          detail={deal.onboardingComplete ? "Submitted" : "Not yet"}
        />
      </div>
      {!deal.onboardingComplete && (
        <a
          href={deal.onboardingUrl}
          className="block text-center bg-[#b22234] text-white text-sm font-semibold py-2 hover:bg-[#8b1a29]"
        >
          Submit customer info →
        </a>
      )}
    </div>
  );
}

function Row({
  label,
  done,
  detail,
}: {
  label: string;
  done: boolean;
  detail: string;
}) {
  return (
    <div className="flex justify-between">
      <span className={done ? "text-green-700" : "text-gray-500"}>
        {done ? "✓ " : "• "}
        {label}
      </span>
      <span className="text-gray-500">{detail}</span>
    </div>
  );
}
