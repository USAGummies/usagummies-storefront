import type { Metadata } from "next";
import { NCSUploadForm } from "./NCSUploadForm";

export const metadata: Metadata = {
  title: "Upload Customer Setup Form | USA Gummies",
  description: "Upload your completed New Customer Setup (NCS-001) form.",
  robots: { index: false, follow: false },
};

export default function NCSUploadPage() {
  return (
    <main className="min-h-screen bg-[#f8f5f0] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0a1e3d] tracking-tight">
            USA Gummies
          </h1>
          <p className="text-sm text-[#0a1e3d]/60 mt-1 tracking-widest uppercase">
            New Customer Setup
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h2 className="text-xl font-semibold text-[#0a1e3d] mb-2">
            Upload Your NCS-001 Form
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Please upload your completed New Customer Setup form. We accept PDF,
            images (PNG, JPG), and Word documents. Maximum file size: 10MB.
          </p>

          <NCSUploadForm />
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          FDA-Registered · cGMP · Made in America
          <br />
          Questions? Email{" "}
          <a
            href="mailto:ben@usagummies.com"
            className="text-[#b22234] hover:underline"
          >
            ben@usagummies.com
          </a>{" "}
          or call (307) 209-4928
        </p>
      </div>
    </main>
  );
}
