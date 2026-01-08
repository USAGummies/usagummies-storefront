// src/components/ui/Reveal.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  delay?: number;
};

export function Reveal({ children, className, as: Tag = "div", delay = 0 }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = ref.current;
    if (!el) return;
    if ("IntersectionObserver" in window === false) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => setVisible(true), delay);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.2 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  const Comp = Tag as React.ElementType;

  return (
    <Comp
      ref={ref as any}
      className={[
        className || "",
        visible ? "fade-in slide-up" : "opacity-0 translate-y-3",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Comp>
  );
}
