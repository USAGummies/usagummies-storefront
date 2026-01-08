// src/components/ui/Glass.tsx
import React from "react";

type GlassProps = {
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
};

const base =
  "backdrop-blur-md bg-[var(--surface)] border border-[var(--border)] shadow-[0_18px_48px_rgba(0,0,0,0.28)]";

export function GlassPanel({ children, className, as: Tag = "div" }: GlassProps) {
  return <Tag className={[base, "rounded-3xl", className || ""].join(" ")}>{children}</Tag>;
}

export function GlassCard({ children, className, as: Tag = "div" }: GlassProps) {
  return <Tag className={[base, "rounded-2xl", className || ""].join(" ")}>{children}</Tag>;
}

export function GlassBar({ children, className, as: Tag = "div" }: GlassProps) {
  return <Tag className={[base, "rounded-xl", className || ""].join(" ")}>{children}</Tag>;
}
