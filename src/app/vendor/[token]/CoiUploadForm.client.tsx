"use client";

/**
 * Vendor COI upload form — Phase 31.2.b.
 *
 * Single-file upload to `POST /api/vendor/[token]/coi`. Client
 * validates MIME + size before sending so the user sees errors
 * immediately, but the server re-validates (defense in depth).
 */
import { useCallback, useId, useRef, useState } from "react";

const ACCEPTED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_BYTES = 10 * 1024 * 1024;

type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; fileName: string; size: number }
  | { kind: "error"; message: string };

export function CoiUploadForm({
  token,
  vendorDisplayName,
}: {
  token: string;
  vendorDisplayName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [state, setState] = useState<State>({ kind: "idle" });

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (state.kind === "uploading") return;
      const file = inputRef.current?.files?.[0];
      if (!file) {
        setState({ kind: "error", message: "Please choose a file." });
        return;
      }
      if (file.size === 0) {
        setState({ kind: "error", message: "File is empty." });
        return;
      }
      if (file.size > MAX_BYTES) {
        setState({
          kind: "error",
          message: `File exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit.`,
        });
        return;
      }
      if (!ACCEPTED_MIME.includes(file.type)) {
        setState({
          kind: "error",
          message: `File type not allowed (got ${file.type}). Use PDF, PNG, JPG, or DOC.`,
        });
        return;
      }
      setState({ kind: "uploading" });
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch(
          `/api/vendor/${encodeURIComponent(token)}/coi`,
          { method: "POST", body: fd },
        );
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          fileName?: string;
          size?: number;
          error?: string;
        };
        if (!res.ok || !body.ok) {
          setState({
            kind: "error",
            message:
              body.error ?? `Upload failed (${res.status}). Try again or contact AP.`,
          });
          return;
        }
        setState({
          kind: "success",
          fileName: body.fileName ?? file.name,
          size: body.size ?? file.size,
        });
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    },
    [state.kind, token],
  );

  if (state.kind === "success") {
    return (
      <div
        style={{
          padding: "16px 18px",
          borderRadius: 8,
          background: "#e6f4ea",
          color: "#1e7a3a",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <strong style={{ display: "block", marginBottom: 4, fontSize: 15 }}>
          ✓ COI received — thank you
        </strong>
        Filed under <code>{state.fileName}</code> ({Math.round(state.size / 1024)} KB).
        Your vendor record at USA Gummies is now updated. You can close this
        window.
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label
        htmlFor={inputId}
        style={{
          display: "block",
          marginBottom: 8,
          color: "#1B2A4A",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Certificate of Insurance ({vendorDisplayName})
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_MIME.join(",")}
        disabled={state.kind === "uploading"}
        style={{
          display: "block",
          width: "100%",
          padding: "8px 10px",
          border: "1px solid rgba(27,42,74,0.16)",
          borderRadius: 8,
          fontSize: 14,
          marginBottom: 16,
        }}
      />
      <button
        type="submit"
        disabled={state.kind === "uploading"}
        style={{
          padding: "10px 20px",
          borderRadius: 8,
          border: "none",
          background: "#1B2A4A",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 600,
          cursor: state.kind === "uploading" ? "wait" : "pointer",
        }}
      >
        {state.kind === "uploading" ? "Uploading…" : "Upload COI"}
      </button>
      {state.kind === "error" && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            background: "#fde8e6",
            color: "#9a1c1c",
            fontSize: 13,
          }}
        >
          {state.message}
        </div>
      )}
    </form>
  );
}
