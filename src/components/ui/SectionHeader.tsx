// src/components/ui/SectionHeader.tsx
export function SectionHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        alignItems: "flex-end",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <div>
        {eyebrow ? <div className="h-eyebrow">{eyebrow}</div> : null}
        <div
          style={{
            fontFamily: "var(--font-display)",
            textTransform: "uppercase",
            fontWeight: 900,
            letterSpacing: "-0.02em",
            fontSize: 26,
            marginTop: 6,
          }}
        >
          {title}
        </div>
        {sub ? (
          <div style={{ opacity: 0.78, lineHeight: 1.6, marginTop: 8 }}>
            {sub}
          </div>
        ) : null}
      </div>

      {right ? <div style={{ marginLeft: "auto" }}>{right}</div> : null}
    </div>
  );
}
