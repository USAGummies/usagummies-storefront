"use client";

import { useState } from "react";
import {
  TrendingUp,
  FileText,
  Share2,
  Users,
  Lightbulb,
  DollarSign,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import {
  NAVY,
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

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
          Marketing Intelligence
        </h1>
        <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
          Traffic, customers, content, social, experiments, paid channels, and creative operations.
        </div>
      </div>

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
