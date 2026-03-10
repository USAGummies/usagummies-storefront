"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DocumentRow = {
  document_id: string;
  filename: string;
  uploaded_at: string;
  chunk_count: number;
  active_chunks: number;
  uploaded_by: string;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadDocuments() {
    try {
      const res = await fetch("/api/ops/abra/ingest", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to load documents",
        );
      }
      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    }
  }

  useEffect(() => {
    void loadDocuments();
  }, []);

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    setLastResult(null);

    try {
      const form = new FormData();
      form.set("file", file);

      const res = await fetch("/api/ops/abra/ingest", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to upload file",
        );
      }

      setLastResult(
        `${data?.filename || file.name}: ${Number(data?.chunks_created || 0)} chunks indexed`,
      );
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function supersedeDocument(documentId: string) {
    setDeletingId(documentId);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch("/api/ops/abra/ingest", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to supersede document",
        );
      }
      setLastResult(
        `Superseded ${Number(data?.superseded_chunks || 0)} chunk(s) for ${documentId}`,
      );
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supersede failed");
    } finally {
      setDeletingId(null);
    }
  }

  const activeCount = useMemo(
    () => documents.reduce((sum, document) => sum + document.active_chunks, 0),
    [documents],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload business documents to ingest into Abra memory.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>Supported: PDF, CSV, XLSX, TXT, JSON</span>
          <span>Max file size: 10MB</span>
          <span>Active document chunks: {activeCount}</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {lastResult ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {lastResult}
        </div>
      ) : null}

      <section
        className={`rounded-xl border-2 border-dashed p-6 text-center ${
          dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void uploadFile(file);
        }}
      >
        <div className="text-sm font-semibold text-slate-900">
          {uploading ? "Uploading and indexing document..." : "Drop a file here or choose from device"}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Each file is chunked, embedded, and stored for semantic retrieval.
        </p>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {uploading ? "Processing..." : "Select file"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,.xlsx,.xls,.txt,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
            event.currentTarget.value = "";
          }}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Uploaded Documents</h2>
          <button
            type="button"
            onClick={() => void loadDocuments()}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
          >
            Refresh
          </button>
        </div>

        {documents.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm text-slate-600">
            No documents uploaded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Filename</th>
                  <th className="px-2 py-2">Uploaded</th>
                  <th className="px-2 py-2">Chunks</th>
                  <th className="px-2 py-2">Uploaded By</th>
                  <th className="px-2 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.document_id} className="border-b border-slate-100">
                    <td className="px-2 py-2">
                      <div className="font-medium text-slate-900">{document.filename}</div>
                      <div className="text-xs text-slate-500">{document.document_id}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {new Date(document.uploaded_at).toLocaleString("en-US")}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {document.active_chunks}/{document.chunk_count}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{document.uploaded_by}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        disabled={deletingId === document.document_id}
                        onClick={() => void supersedeDocument(document.document_id)}
                        className="rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {deletingId === document.document_id ? "Updating..." : "Supersede"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
