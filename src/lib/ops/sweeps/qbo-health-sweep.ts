import { proactiveMessage } from "@/lib/ops/abra-slack-responder";

export type QBOHealthSweepResult = {
  uncategorized: number;
  autoCategorized: number;
  needsManualReview: number;
  investorTransfers: number;
  newVendorsFound: number;
  newVendorNames: string[];
  healthScore: number; // 0–100: % of transactions categorized
  vendorGapCount: number; // # of known vendors missing from QBO
};

// Known USA Gummies supply chain vendors — used to detect new/unknown vendors in transactions
const KNOWN_VENDOR_KEYWORDS = [
  "albanese", "belmark", "ninjaprinthouse", "ninja print",
  "powers confections", "pirateship", "pirate ship",
  "shopify", "amazon", "faire",
  "rene", "gonzalez", // investor transfers
  "stripe", "paypal", "square",
];

// Known USA Gummies vendors that should exist in QBO
const REQUIRED_VENDORS = [
  { name: "Albanese", aliases: ["albanese confectionery", "albanese candy"] },
  { name: "Belmark", aliases: ["belmark", "ninjaprinthouse", "ninja print house"] },
  { name: "Powers Confections", aliases: ["powers confections", "powers"] },
  { name: "PirateShip", aliases: ["pirateship", "pirate ship"] },
  { name: "Shopify", aliases: ["shopify"] },
  { name: "Amazon", aliases: ["amazon.com", "amazon seller", "amazon services"] },
  { name: "Faire", aliases: ["faire", "faire wholesale"] },
];

function resolveInternalHost(): string {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

export async function runQBOHealthSweep(): Promise<QBOHealthSweepResult> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    throw new Error("CRON_SECRET not configured");
  }

  const host = resolveInternalHost();
  const controlChannel = process.env.SLACK_CHANNEL_CONTROL || process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4";

  // Step 1: Preview uncategorized transactions
  const previewRes = await fetch(`${host}/api/ops/qbo/categorize-batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode: "preview" }),
    signal: AbortSignal.timeout(30_000),
  });

  const previewData = (await previewRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!previewRes.ok) {
    throw new Error(
      typeof previewData.error === "string"
        ? previewData.error
        : `QBO preview failed (${previewRes.status})`,
    );
  }

  const total = typeof previewData.total === "number" ? previewData.total : 0;
  const autoCategorizeable = typeof previewData.autoCategorizeable === "number" ? previewData.autoCategorizeable : 0;
  const needsReview = typeof previewData.needsReview === "number" ? previewData.needsReview : 0;
  const reneTransfers = typeof previewData.reneTransfers === "number" ? previewData.reneTransfers : 0;
  const previewItems = Array.isArray(previewData.items) ? previewData.items as Array<{ description: string; amount: number; date: string }> : [];

  // Step 2: Auto-categorize high-confidence matches
  let autoCategorized = 0;
  if (autoCategorizeable > 0) {
    const execRes = await fetch(`${host}/api/ops/qbo/categorize-batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "execute" }),
      signal: AbortSignal.timeout(50_000),
    });
    const execData = (await execRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (execRes.ok) {
      autoCategorized = typeof execData.categorized === "number" ? execData.categorized : 0;
    }
  }

  // Step 3: Check for vendors in recent transactions not in QBO vendor list
  const vendorsRes = await fetch(`${host}/api/ops/qbo/query?type=vendors`, {
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  let newVendorNames: string[] = [];
  let vendorGapCount = 0;

  if (vendorsRes?.ok) {
    const vendorData = (await vendorsRes.json().catch(() => ({}))) as {
      vendors: Array<{ Name: string; Active: boolean }>;
    };
    const qboVendorNames = (vendorData.vendors || [])
      .filter(v => v.Active)
      .map(v => v.Name.toLowerCase());

    // Check which required vendors are missing from QBO
    for (const rv of REQUIRED_VENDORS) {
      const found = qboVendorNames.some(qn => rv.aliases.some(alias => qn.includes(alias)));
      if (!found) vendorGapCount++;
    }

    // Find transaction descriptions that look like unknown vendors
    const unknownVendors = new Set<string>();
    for (const item of previewItems) {
      const desc = (item.description || "").toLowerCase();
      const isKnown = KNOWN_VENDOR_KEYWORDS.some(kw => desc.includes(kw));
      const isInQBO = qboVendorNames.some(qn => desc.includes(qn.split(" ")[0]));
      if (!isKnown && !isInQBO && desc.length > 3) {
        // Capitalize and trim for display
        const displayName = item.description.slice(0, 40).trim();
        unknownVendors.add(displayName);
      }
    }
    newVendorNames = Array.from(unknownVendors).slice(0, 5);
  }

  // Step 4: Calculate health score
  // If total == 0, everything is categorized (100%). Otherwise score is % already categorized.
  const totalTransactionsInQBO = total + autoCategorized;
  const healthScore = totalTransactionsInQBO === 0
    ? 100
    : Math.round((autoCategorized / totalTransactionsInQBO) * 100);

  const result: QBOHealthSweepResult = {
    uncategorized: total,
    autoCategorized,
    needsManualReview: needsReview,
    investorTransfers: reneTransfers,
    newVendorsFound: newVendorNames.length,
    newVendorNames,
    healthScore,
    vendorGapCount,
  };

  // Step 5: Post to #abra-control if there are items needing review
  if (needsReview > 0 || newVendorNames.length > 0 || vendorGapCount > 0) {
    const topItems = previewItems
      .filter(item => {
        const desc = (item.description || "").toLowerCase();
        return !KNOWN_VENDOR_KEYWORDS.some(kw => desc.includes(kw));
      })
      .slice(0, 5);

    const lines: string[] = [
      `🏦 *QBO Health Check* (score: ${healthScore}%)`,
    ];

    if (autoCategorized > 0) {
      lines.push(`✓ Auto-categorized ${autoCategorized} transaction${autoCategorized === 1 ? "" : "s"}`);
    }

    if (needsReview > 0) {
      lines.push(``, `*${needsReview} transaction${needsReview === 1 ? "" : "s"} need manual review:*`);
      for (const item of topItems) {
        const amt = typeof item.amount === "number" ? ` ($${Math.abs(item.amount).toFixed(2)})` : "";
        lines.push(`• ${item.date}: ${item.description.slice(0, 50)}${amt}`);
      }
      if (needsReview > topItems.length) {
        lines.push(`_…and ${needsReview - topItems.length} more_`);
      }
      lines.push(``, `Should I categorize them? Reply with the category or "skip".`);
    }

    if (newVendorNames.length > 0) {
      lines.push(``, `*New/unknown vendors in recent transactions:*`);
      for (const name of newVendorNames) {
        lines.push(`• ${name}`);
      }
      lines.push(`These vendors aren't in QBO yet — should I add them?`);
    }

    if (vendorGapCount > 0) {
      lines.push(``, `⚠️ ${vendorGapCount} known USA Gummies vendor${vendorGapCount === 1 ? "" : "s"} still missing from QBO. Run \`qbo_setup_assessment\` for details.`);
    }

    if (reneTransfers > 0) {
      lines.push(``, `🔴 ${reneTransfers} investor transfer${reneTransfers === 1 ? "" : "s"} from Rene detected — already flagged to alerts.`);
    }

    await proactiveMessage({
      target: "channel",
      channelOrUserId: controlChannel,
      message: lines.join("\n"),
      requiresResponse: needsReview > 0 || newVendorNames.length > 0,
    }).catch(() => {});
  }

  return result;
}
