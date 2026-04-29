"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Only expose raw error.message in development — in production it
  // can leak stack traces and internal paths to end users.
  const isDev = process.env.NODE_ENV === "development";

  return (
    <html>
      <body>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ opacity: 0.8 }}>
            Please refresh or contact support if the issue persists.
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
          {isDev ? (
            <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", fontSize: 12 }}>
              {String(error?.message || error)}
            </pre>
          ) : null}
        </div>
      </body>
    </html>
  );
}
