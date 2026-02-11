"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

const MAX_CHARS = 200;

export function GiftNote() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "note", note: note.trim() ? `🎁 Gift note: ${note.trim()}` : "" }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaved(true);
        trackEvent("gift_note_saved", { length: note.trim().length });
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // silent fail
    } finally {
      setSaving(false);
    }
  }, [note, saving]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          trackEvent("gift_note_opened", {});
        }}
        className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2.5 text-xs font-semibold text-[var(--muted)] transition hover:bg-white hover:text-[var(--text)]"
      >
        <span aria-hidden="true">🎁</span>
        <span>Add a gift note</span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
          <span aria-hidden="true">🎁</span>
          Gift note
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            if (note.trim()) save();
          }}
          className="text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        >
          {note.trim() ? "Save & close" : "Close"}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, MAX_CHARS))}
        onBlur={() => { if (note.trim()) save(); }}
        placeholder="Add a personal message for the recipient..."
        rows={3}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[rgba(239,59,59,0.25)]"
        maxLength={MAX_CHARS}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--muted)]">
          {note.length}/{MAX_CHARS}
        </span>
        {saved && (
          <span className="text-[10px] font-semibold text-[var(--candy-green,#22c55e)]">
            ✓ Saved
          </span>
        )}
      </div>
    </div>
  );
}
