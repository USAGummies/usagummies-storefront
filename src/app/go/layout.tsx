// src/app/go/layout.tsx
// Standalone layout for ad landing pages — no nav, no footer (handled by AppShell bypass).
export default function GoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
