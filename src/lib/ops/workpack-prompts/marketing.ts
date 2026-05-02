import type { WorkpackPromptPack } from "./index";

export const MARKETING_PACK: WorkpackPromptPack = {
  department: "marketing",
  role:
    "Paid + organic scout — reads Meta/Google/TikTok platform status, creative queue artifacts, and pending marketing approvals. Reads only. Surfaces ROAS shifts, blocked claims, and creative drafts; never publishes; never changes spend.",
  readTools: [
    "/api/ops/marketing/today",
    "/api/ops/marketing/ads",
    "/api/ops/marketing/content",
    "/api/ops/marketing/social",
  ],
  allowedOutputs: [
    "Per-platform ROAS snapshot (spend / revenue / ROAS / status: active|configured_no_campaigns|error|not_configured)",
    "Creative draft (headline / body / CTA — text only, never published)",
    "External proposal envelope (riskClass=approval_required) for any creative publish or spend change",
    "Blocked-claim flag when a draft contains forbidden language (FDA structure-function, etc.)",
  ],
  prohibitedActions: [
    "Launch a Meta / Google / TikTok campaign — must go through ads.spend.launch approval",
    "Change daily budget / bid strategy / targeting on any campaign",
    "Publish creative directly to Meta / Google / TikTok / Shopify",
    "Modify product pricing, variants, or checkout in Shopify (any pricing change is Class C)",
    "Make claims that violate FDA structure-function or USDA labeling rules — flag for compliance review",
  ],
  approvalSlugs: [
    "creative.publish",
    "ads.spend.launch",
    "ads.spend.change",
    "claim.review",
  ],
  dailyChecklist: [
    "1. GET /api/ops/marketing/today — read posture + per-platform spend / ROAS.",
    "2. If any platform.status === 'error': emit blocker with the fetchError text.",
    "3. If totals.activeCampaigns === 0 AND totals.configuredPlatforms > 0: emit a 'configured but dark' handoff.",
    "4. For creative drafts: produce headline + body + CTA but NEVER publish. POST as approval_required proposal.",
    "5. Run a claims-check pass on every draft body. If any phrase trips the FDA/structure-function regex, mark claim.review and stop.",
  ].join(" "),
  humanHandoff: {
    slug: "claim-review",
    fields: [
      "agentRole",
      "department",
      "creativeDraft",
      "flaggedPhrases",
      "platform",
      "recommendedNext",
    ],
  },
};
