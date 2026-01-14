"use client";

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
          className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#DBAA79]/50"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Your email"
          className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#DBAA79]/50"
        />
      </div>

      <textarea
        name="message"
        required
        rows={compact ? 4 : 5}
        placeholder="How can we help?"
        className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#DBAA79]/50"
      />

      <button
        type="submit"
        disabled={status === "sending" || status === "sent"}
        className="inline-flex w-full items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-70"
      >
        {status === "sending"
          ? "Sending…"
          : status === "sent"
          ? "Message sent ✓"
          : "Send message"}
      </button>

      {status === "error" ? (
        <p className="text-sm text-red-400">
          Something went wrong. Please try again in a moment.
        </p>
      ) : null}

      <p className="text-xs text-white/50">
        We’ll reply to the email you provide. Your message is sent securely.
      </p>
    </form>
  );
}
