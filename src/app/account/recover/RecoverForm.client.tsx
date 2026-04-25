"use client";

import { useState } from "react";

type FormState = "idle" | "submitting" | "success" | "error";

export function RecoverForm() {
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("submitting");
    setErrorMsg("");
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    try {
      const res = await fetch("/api/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover", email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok !== true) {
        setErrorMsg(data.error || "Unable to send the reset email. Try again.");
        setState("error");
        return;
      }
      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md p-4">
        Done — if an account exists for that email, Shopify just sent a reset
        link. Check the inbox + spam folder.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#b22234] focus:border-transparent outline-none"
        />
      </div>
      {state === "error" && errorMsg && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={state === "submitting"}
        className="w-full bg-[#b22234] hover:bg-[#8b1a29] disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-lg text-sm transition-colors"
      >
        {state === "submitting" ? "Sending…" : "Send reset email"}
      </button>
    </form>
  );
}
