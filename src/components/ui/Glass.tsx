// src/components/ui/Glass.tsx
import React from "react";

type GlassProps = {
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
};

const base =
  "bg-[var(--surface)] border border-[var(--border)] shadow-[0_24px_60px_rgba(15,27,45,0.22)]";

export function GlassPanel({ children, className, as: Tag = "div" }: GlassProps) {
  return <Tag className={[base, "rounded-3xl", className || ""].join(" ")}>{children}</Tag>;
}

export function GlassCard({ children, className, as: Tag = "div" }: GlassProps) {
  return <Tag className={[base, "rounded-2xl", className || ""].join(" ")}>{children}</Tag>;
}

export function GlassBar({ children, className, as: Tag = "div" }: GlassProps) {
  return <Tag className={[base, "rounded-xl", className || ""].join(" ")}>{children}</Tag>;
}
