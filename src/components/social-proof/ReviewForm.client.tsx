"use client";

import React from "react";

type ReviewFormProps = {
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function ReviewForm({ onSuccess, onCancel }: ReviewFormProps) {
  const [rating, setRating] = React.useState(0);
  const [hoverRating, setHoverRating] = React.useState(0);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [previews, setPreviews] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const previewsRef = React.useRef<string[]>([]);

  const handlePhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length);
    if (!files.length) return;

    const validFiles: File[] = [];
    const newPreviews: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 5 * 1024 * 1024) continue; // 5MB max per file
      validFiles.push(file);
      newPreviews.push(URL.createObjectURL(file));
    }

    setPhotos((prev) => [...prev, ...validFiles]);
    setPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  React.useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  React.useEffect(() => {
    return () => {
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (rating === 0) {
      setError("Please select a star rating.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email.");
      return;
    }
    if (!body.trim() || body.trim().length < 10) {
      setError("Please write at least a short review (10+ characters).");
      return;
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("rating", String(rating));
      formData.append("name", name.trim());
      formData.append("email", email.trim().toLowerCase());
      formData.append("title", title.trim());
      formData.append("body", body.trim());

      for (const photo of photos) {
        formData.append("photos", photo);
      }

      const res = await fetch("/api/reviews", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setSuccess(true);
      onSuccess?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-3 text-center">
        <div className="text-2xl">🎉</div>
        <div className="text-sm font-black text-[var(--text)]">
          Thank you for your review!
        </div>
        <div className="text-xs text-[var(--muted)]">
          Your review has been submitted and will appear after approval.
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full bg-[var(--surface-strong)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)]"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-sm font-black text-[var(--text)]">Write a review</div>

      {/* Star rating */}
      <div className="space-y-1">
        <label className="text-xs text-[var(--muted)]">Rating *</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              className="text-2xl transition-transform hover:scale-110"
              aria-label={`${star} star${star > 1 ? "s" : ""}`}
            >
              <span
                className={
                  star <= (hoverRating || rating)
                    ? "text-[var(--candy-yellow)]"
                    : "text-gray-300"
                }
              >
                ★
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Name + Email */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-[var(--muted)]">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
            maxLength={60}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--muted)]">Email *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="w-full rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
          />
          <div className="text-[10px] text-[var(--muted)]">
            Not displayed publicly. Used to verify your purchase.
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="space-y-1">
        <label className="text-xs text-[var(--muted)]">Review title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Summarize your experience"
          className="w-full rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
          maxLength={120}
        />
      </div>

      {/* Body */}
      <div className="space-y-1">
        <label className="text-xs text-[var(--muted)]">Your review *</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Tell us what you think about USA Gummies..."
          rows={4}
          className="w-full resize-none rounded-xl border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
          maxLength={1500}
        />
        <div className="text-right text-[10px] text-[var(--muted)]">
          {body.length}/1500
        </div>
      </div>

      {/* Photo upload */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--muted)]">
          Photos (optional, max 3)
        </label>
        {previews.length > 0 && (
          <div className="flex gap-2">
            {previews.map((src, idx) => (
              <div key={src} className="relative">
                <img
                  src={src}
                  alt={`Upload ${idx + 1}`}
                  className="h-16 w-16 rounded-xl border border-[rgba(15,27,45,0.12)] object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white"
                  aria-label="Remove photo"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {photos.length < 3 && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotos}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-dashed border-[rgba(15,27,45,0.2)] bg-[var(--surface-strong)] px-4 py-2 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--text)] hover:text-[var(--text)]"
            >
              + Add photo{photos.length > 0 ? "s" : ""}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-candy pressable px-5 py-2.5 text-sm font-bold disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit review"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full bg-[var(--surface-strong)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface)]"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
