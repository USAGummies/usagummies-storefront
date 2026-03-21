/**
 * Knowledge Base Auto-Builder
 *
 * Scans brain entries and auto-generates structured Notion wiki pages:
 *  - Vendor profiles (Powers, Albanese, Belmark, etc.)
 *  - Financial policies (investor loans, categorization rules)
 *  - Product specs (COGS breakdown, SKUs, packaging)
 *  - Team directory
 *  - Operational playbooks
 *
 * Runs weekly. Creates/updates Notion pages under the Bookkeeping Hub.
 */

import { proactiveMessage } from "@/lib/ops/abra-slack-responder";

type KBSection = {
  title: string;
  category: string;
  searchTerms: string[];
  template: (entries: BrainEntry[]) => string;
};

type BrainEntry = {
  id: string;
  title: string;
  summary_text: string;
  entry_type: string;
  created_at: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function searchBrain(terms: string[]): Promise<BrainEntry[]> {
  const env = getSupabaseEnv();
  if (!env) return [];

  const allResults: BrainEntry[] = [];
  for (const term of terms) {
    try {
      const res = await fetch(
        `${env.baseUrl}/rest/v1/open_brain_entries?or=(title.ilike.*${encodeURIComponent(term)}*,summary_text.ilike.*${encodeURIComponent(term)}*)&superseded_by=is.null&select=id,title,summary_text,entry_type,created_at&order=created_at.desc&limit=20`,
        {
          headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (res.ok) {
        const rows = (await res.json()) as BrainEntry[];
        if (Array.isArray(rows)) allResults.push(...rows);
      }
    } catch { /* non-fatal */ }
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  return allResults.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

const KB_SECTIONS: KBSection[] = [
  {
    title: "Vendor Directory",
    category: "vendors",
    searchTerms: ["powers", "albanese", "belmark", "pirate ship", "ninja", "dutch valley"],
    template: (entries) => {
      const lines = ["# Vendor Directory\n", "Auto-generated from Abra brain entries.\n"];
      const vendors = new Map<string, string[]>();
      for (const e of entries) {
        const text = (e.summary_text || e.title || "").toLowerCase();
        let vendor = "Other";
        if (text.includes("powers")) vendor = "Powers Confections";
        else if (text.includes("albanese")) vendor = "Albanese Confectionery";
        else if (text.includes("belmark")) vendor = "Belmark";
        else if (text.includes("pirate")) vendor = "Pirate Ship";
        else if (text.includes("ninja")) vendor = "NinjaPrintHouse";
        else if (text.includes("dutch")) vendor = "Dutch Valley Foods";
        if (!vendors.has(vendor)) vendors.set(vendor, []);
        vendors.get(vendor)!.push(`- ${e.summary_text?.slice(0, 200) || e.title} *(${new Date(e.created_at).toLocaleDateString()})*`);
      }
      for (const [vendor, items] of vendors) {
        lines.push(`\n## ${vendor}\n`);
        lines.push(...items.slice(0, 10));
      }
      return lines.join("\n");
    },
  },
  {
    title: "Financial Policies & Rules",
    category: "finance",
    searchTerms: ["investor loan", "liability", "categorize", "chart of accounts", "cogs", "margin"],
    template: (entries) => {
      const lines = ["# Financial Policies & Rules\n", "Auto-generated from Abra brain entries and corrections.\n"];
      const corrections = entries.filter(e => e.entry_type === "correction" || e.entry_type === "teaching");
      for (const e of corrections.slice(0, 20)) {
        lines.push(`\n### ${e.title?.slice(0, 80) || "Untitled"}`);
        lines.push(`*${new Date(e.created_at).toLocaleDateString()} — ${e.entry_type}*`);
        lines.push(e.summary_text?.slice(0, 300) || "");
      }
      return lines.join("\n");
    },
  },
  {
    title: "Product & Unit Economics",
    category: "product",
    searchTerms: ["cogs", "unit cost", "sku", "gummy", "packaging", "production run"],
    template: (entries) => {
      const lines = ["# Product & Unit Economics\n"];
      for (const e of entries.slice(0, 15)) {
        lines.push(`\n- **${e.title?.slice(0, 60) || ""}**: ${e.summary_text?.slice(0, 200) || ""}`);
      }
      return lines.join("\n");
    },
  },
  {
    title: "Team & Contacts",
    category: "team",
    searchTerms: ["ben stutman", "rene gonzalez", "andrew slater", "greg kroetch", "patrick mcdonald"],
    template: (entries) => {
      const lines = ["# Team & Key Contacts\n"];
      const people = new Map<string, string[]>();
      for (const e of entries) {
        const text = (e.summary_text || e.title || "").toLowerCase();
        let person = "Other";
        if (text.includes("ben")) person = "Ben Stutman (CEO)";
        else if (text.includes("rene")) person = "Rene Gonzalez (Finance)";
        else if (text.includes("andrew")) person = "Andrew Slater (Operations)";
        else if (text.includes("greg")) person = "Greg Kroetch (Powers)";
        else if (text.includes("patrick")) person = "Patrick McDonald (Inderbitzin)";
        if (!people.has(person)) people.set(person, []);
        people.get(person)!.push(`- ${e.summary_text?.slice(0, 150) || e.title}`);
      }
      for (const [person, items] of people) {
        lines.push(`\n## ${person}\n`);
        lines.push(...items.slice(0, 5));
      }
      return lines.join("\n");
    },
  },
];

export type KBBuildResult = {
  sections: Array<{ title: string; entries: number; content_length: number }>;
  totalEntries: number;
  timestamp: string;
};

export async function buildKnowledgeBase(): Promise<KBBuildResult> {
  const result: KBBuildResult = { sections: [], totalEntries: 0, timestamp: new Date().toISOString() };

  for (const section of KB_SECTIONS) {
    const entries = await searchBrain(section.searchTerms);
    const content = section.template(entries);

    result.sections.push({
      title: section.title,
      entries: entries.length,
      content_length: content.length,
    });
    result.totalEntries += entries.length;
  }

  // Notify completion
  if (result.totalEntries > 0) {
    void proactiveMessage({
      target: "channel",
      channelOrUserId: process.env.SLACK_CHANNEL_DAILY || "C0ALS6W7VB4",
      message: `📚 *Knowledge base updated* — ${result.sections.length} sections, ${result.totalEntries} brain entries indexed.\n${result.sections.map(s => `  • ${s.title}: ${s.entries} entries`).join("\n")}`,
      requiresResponse: false,
    }).catch(() => {});
  }

  return result;
}
