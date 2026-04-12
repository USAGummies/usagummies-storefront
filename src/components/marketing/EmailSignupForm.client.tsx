"use client";

import { useState, type FormEvent } from "react";

export default function EmailSignupForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          source: "homepage",
          intent: "newsletter",
        }),
      });
      if (res.ok) {
        setStatus("success");
        setEmail("");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[rgba(45,122,58,0.3)] bg-[rgba(45,122,58,0.08)] px-5 py-4 text-sm font-semibold text-[#2D7A3A]">
        <span>&#10003;</span> You&rsquo;re on the list. Welcome to the crew.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap gap-3 items-center rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-1.5"
    >
      <input
        type="email"
        name="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
        className="flex-1 min-w-[200px] rounded-full border border-[rgba(15,27,45,0.15)] bg-white px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[rgba(239,59,59,0.35)]"
        aria-label="Enter your email for updates"
        required
        disabled={status === "loading"}
      />
      <button
        type="submit"
        className="btn btn-outline pressable px-5 py-3 font-semibold w-full sm:w-auto"
        disabled={status === "loading"}
      >
        {status === "loading" ? "Joining..." : "Sign me up"}
      </button>
      {status === "error" && (
        <div className="w-full text-xs text-[#c7362c] font-semibold">
          Something went wrong. Try again.
        </div>
      )}
    </form>
  );
}
