"use client";

import { useCallback, useState } from "react";
import {
  TrendingUp,
  FileText,
  Share2,
  Users,
  Lightbulb,
  DollarSign,
  Image as ImageIcon,
  Brain,
  type LucideIcon,
} from "lucide-react";
import {
  NAVY,
  GOLD,
  RED,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";
import { TrafficTab } from "./tabs/TrafficTab";
import { ContentTab } from "./tabs/ContentTab";
import { SocialTab } from "./tabs/SocialTab";
import { CustomersTab } from "./tabs/CustomersTab";
import { IntelligenceTab } from "./tabs/IntelligenceTab";
import { PaidAdsTab } from "./tabs/PaidAdsTab";
import { ImagesTab } from "./tabs/ImagesTab";

const TABS = [
  { key: "traffic", label: "Traffic & Funnel", icon: TrendingUp },
  { key: "content", label: "Content & SEO", icon: FileText },
  { key: "social", label: "Social", icon: Share2 },
  { key: "customers", label: "Customers", icon: Users },
  { key: "intelligence", label: "Intelligence", icon: Lightbulb },
  { key: "paid", label: "Paid Ads", icon: DollarSign },
  { key: "images", label: "Image Library", icon: ImageIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type TabButtonProps = {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
};

function TabButton({ label, icon: Icon, active, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 999,
        border: `1px solid ${active ? "rgba(27,42,74,0.16)" : BORDER}`,
        background: active ? "rgba(27,42,74,0.08)" : CARD,
        color: NAVY,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
      }}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function ActiveTab({ tab }: { tab: TabKey }) {
  if (tab === "traffic") return <TrafficTab />;
  if (tab === "content") return <ContentTab />;
  if (tab === "social") return <SocialTab />;
  if (tab === "customers") return <CustomersTab />;
  if (tab === "intelligence") return <IntelligenceTab />;
  if (tab === "paid") return <PaidAdsTab />;
  return <ImagesTab />;
}

export function MarketingView() {
  const [tab, setTab] = useState<TabKey>("traffic");
  const [brain, setBrain] = useState<{ insights: string[]; sources: { title: string; source_table: string }[] } | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string | null>(null);

  const fetchBrainInsights = useCallback(async () => {
    setBrainLoading(true);
    setBrainError(null);
    try {
      const res = await fetch("/api/ops/abra/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "marketing campaigns SEO content social media traffic conversion customers" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch insights");
      setBrain(data);
    } catch (err) {
      setBrainError(err instanceof Error ? err.message : "Brain query failed");
    } finally {
      setBrainLoading(false);
    }
  }, []);

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
            Marketing Intelligence
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Traffic, customers, content, social, experiments, paid channels, and creative operations.
          </div>
        </div>
        <button
          onClick={() => void fetchBrainInsights()}
          disabled={brainLoading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            border: `1px solid ${brain ? `${GOLD}60` : BORDER}`,
            borderRadius: 10, background: brain ? `${GOLD}0d` : CARD,
            color: NAVY, padding: "8px 12px", fontSize: 12, fontWeight: 700,
            cursor: brainLoading ? "default" : "pointer",
            opacity: brainLoading ? 0.7 : 1,
          }}
        >
          <Brain size={14} />
          {brainLoading ? "Thinking..." : brain ? "Refresh Intel" : "🧠 Intel"}
        </button>
      </div>

      {brainError && (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}0a`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: RED }}>
          🧠 Brain: {brainError}
        </div>
      )}
      {brain && brain.insights.length > 0 && (
        <div style={{ background: `${GOLD}0d`, border: `1px solid ${GOLD}30`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: NAVY, marginBottom: 10, fontSize: 14 }}>
            <Brain size={16} /> Campaign Intelligence
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc" }}>
            {brain.insights.map((insight, i) => (
              <li key={i} style={{ fontSize: 13, color: NAVY, lineHeight: 1.6, marginBottom: 4 }}>{insight}</li>
            ))}
          </ul>
          {brain.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {brain.sources.map((s, i) => (
                <span key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: s.source_table === "email" ? `${NAVY}10` : `${GOLD}18`,
                  border: `1px solid ${s.source_table === "email" ? `${NAVY}20` : `${GOLD}30`}`,
                  borderRadius: 6, padding: "3px 8px", fontSize: 11, color: NAVY, fontWeight: 600,
                }}>
                  {s.source_table === "email" ? "📧" : "🧠"} {s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginBottom: 14,
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {TABS.map((item) => (
          <TabButton
            key={item.key}
            label={item.label}
            icon={item.icon}
            active={tab === item.key}
            onClick={() => setTab(item.key)}
          />
        ))}
      </div>

      <ActiveTab tab={tab} />
    </div>
  );
}
