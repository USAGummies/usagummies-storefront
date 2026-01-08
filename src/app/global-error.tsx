"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Global error</h1>
          <p style={{ opacity: 0.8 }}>
            This prevents the dev overlay from looping when required error components are missing.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 16,
              borderRadius: 999,
              padding: "10px 14px",
              background: "rgba(0,0,0,0.08)",
              border: "1px solid rgba(0,0,0,0.12)",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", fontSize: 12 }}>
            {String(error?.message || error)}
          </pre>
        </div>
      </body>
    </html>
  );
}
