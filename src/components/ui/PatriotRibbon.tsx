// src/components/ui/PatriotRibbon.tsx
export function PatriotRibbon({ height = 14 }: { height?: number }) {
  return (
    <div className="patriot-ribbon" aria-hidden="true">
      <div
        className="patriot-ribbon__inner"
        style={{ height: Math.max(10, Math.min(18, height)) }}
      />
    </div>
  );
}
