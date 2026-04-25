"use client";

import { useState, useRef } from "react";

type UploadState = "idle" | "uploading" | "success" | "error";

export function NCSUploadForm() {
  const [state, setState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileName(file?.name || "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErrorMsg("Please select a file to upload.");
      setState("error");
      return;
    }
    if (!customerName.trim()) {
      setErrorMsg("Please enter your company or contact name.");
      setState("error");
      return;
    }

    setState("uploading");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("customer_name", customerName.trim());
    // doc_type is the new canonical field; form_type kept for backward
    // compatibility with any older callers / proxies.
    formData.append("doc_type", "ncs");
    formData.append("form_type", "ncs");
    formData.append("notes", notes.trim());

    try {
      const res = await fetch("/api/ops/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Upload failed. Please try again.");
        setState("error");
        return;
      }
      setState("success");
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setState("error");
    }
  };

  if (state === "success") {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-[#0a1e3d] mb-2">
          Form Uploaded Successfully
        </h3>
        <p className="text-sm text-gray-600">
          Thank you! We&apos;ve received your NCS-001 form and will process it
          shortly. You&apos;ll hear from us soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Company / Contact Name */}
      <div>
        <label htmlFor="customer_name" className="block text-sm font-medium text-gray-700 mb-1">
          Company or Contact Name *
        </label>
        <input
          id="customer_name"
          type="text"
          required
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="e.g. Jungle Jim's International Market"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
        />
      </div>

      {/* File Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Upload Completed NCS-001 Form *
        </label>
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-[#b22234] hover:bg-red-50/30 transition-colors"
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx"
            onChange={handleFileChange}
            className="hidden"
          />
          {fileName ? (
            <div>
              <svg className="w-8 h-8 text-[#b22234] mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium text-[#0a1e3d]">{fileName}</p>
              <p className="text-xs text-gray-500 mt-1">Click to change file</p>
            </div>
          ) : (
            <div>
              <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-gray-600">
                Click to select file or drag and drop
              </p>
              <p className="text-xs text-gray-400 mt-1">
                PDF, PNG, JPG, or Word — Max 10MB
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Any additional notes..."
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none resize-none"
        />
      </div>

      {/* Error */}
      {state === "error" && errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={state === "uploading"}
        className="w-full bg-[#b22234] text-white font-semibold py-3 px-6 rounded-lg hover:bg-[#8b1a29] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
      >
        {state === "uploading" ? "Uploading..." : "Upload Form"}
      </button>
    </form>
  );
}
