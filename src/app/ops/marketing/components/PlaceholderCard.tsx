import { Info } from "lucide-react";
import {
  NAVY,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type Props = {
  title: string;
  description: string;
  checklist?: string[];
};

export function PlaceholderCard({ title, description, checklist = [] }: Props) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY, fontWeight: 800, marginBottom: 8 }}>
        <Info size={16} />
        {title}
      </div>
      <div style={{ color: TEXT_DIM, fontSize: 13, lineHeight: 1.5 }}>{description}</div>
      {checklist.length > 0 ? (
        <div style={{ marginTop: 10, display: "grid", gap: 5 }}>
          {checklist.map((item) => (
            <div key={item} style={{ fontSize: 12, color: GOLD, fontWeight: 700 }}>
              • {item}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
