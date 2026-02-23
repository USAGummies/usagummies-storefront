"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/ops";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f1117",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 40,
          background: "#1a1d27",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#fff",
              fontFamily: "var(--font-display), system-ui, sans-serif",
              letterSpacing: "0.02em",
            }}
          >
            USA Gummies
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.45)",
              marginTop: 6,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Operations Platform
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="email"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "#0f1117",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              color: "#fff",
              fontSize: 15,
              outline: "none",
              marginBottom: 18,
              boxSizing: "border-box",
            }}
            placeholder="you@usagummies.com"
          />

          <label
            htmlFor="password"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "#0f1117",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              color: "#fff",
              fontSize: 15,
              outline: "none",
              marginBottom: 24,
              boxSizing: "border-box",
            }}
            placeholder="Enter your password"
          />

          {error && (
            <div
              style={{
                background: "rgba(220,38,38,0.12)",
                border: "1px solid rgba(220,38,38,0.25)",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 18,
                color: "#ef4444",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "13px 0",
              background: loading ? "rgba(199,54,44,0.6)" : "#c7362c",
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
              border: "none",
              borderRadius: 10,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.2s",
              letterSpacing: "0.02em",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div
          style={{
            textAlign: "center",
            marginTop: 24,
            fontSize: 11,
            color: "rgba(255,255,255,0.25)",
          }}
        >
          USA Gummies Operations Platform v1.0
        </div>
      </div>
    </div>
  );
}
