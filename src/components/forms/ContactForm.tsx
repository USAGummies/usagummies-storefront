"use client";

import Link from "next/link";
import { useState } from "react";
import { sendContactEmail } from "@/lib/email/sendContactEmail";

export default function ContactForm({
  context,
  compact = false,
}: {
  context: string;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function action(formData: FormData) {
    setStatus("sending");
    try {
      formData.set("context", context);
      await sendContactEmail(formData);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form action={action} className={compact ? "mt-4 space-y-3" : "mt-6 space-y-4"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="name"
          required
          placeholder="Your name"
          className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[rgba(239,59,59,0.18)]"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Your email"
          className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[rgba(239,59,59,0.18)]"
        />
      </div>

      <textarea
        name="message"
        required
        rows={compact ? 4 : 5}
        placeholder="How can we help?"
        className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[rgba(239,59,59,0.18)]"
      />

      <button
        type="submit"
        disabled={status === "sending" || status === "sent"}
        className="btn btn-candy inline-flex w-full items-center justify-center rounded-2xl px-6 py-3 text-sm font-semibold disabled:opacity-70"
      >
        {status === "sending"
          ? "Sending..."
          : status === "sent"
          ? "Message sent"
          : "Send message"}
      </button>

      {status === "error" ? (
        <p className="text-sm text-red-400">
          Something went wrong. Please try again in a moment.
        </p>
      ) : null}

      <p className="text-xs text-[var(--muted)]">
        We will reply to the email you provide. By submitting, you agree to our{" "}
        <Link href="/policies/privacy" className="underline underline-offset-4 hover:text-[var(--text)]">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
