import { getNotionApiKey } from "@/lib/notion/credentials";

export type IntegrationStatus = {
  name: string;
  configured: boolean;
  envVars: { key: string; set: boolean }[];
};

type IntegrationDefinition = {
  name: string;
  // Any one group can satisfy configuration; all vars in that group must be set.
  groups: string[][];
};

const DEFINITIONS: IntegrationDefinition[] = [
  { name: "Shopify Admin", groups: [["SHOPIFY_ADMIN_TOKEN"]] },
  {
    name: "Shopify Storefront",
    groups: [["NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN"]],
  },
  { name: "Plaid", groups: [["PLAID_CLIENT_ID", "PLAID_SECRET"]] },
  {
    name: "GA4",
    groups: [["GA4_SERVICE_ACCOUNT_JSON"], ["GOOGLE_APPLICATION_CREDENTIALS"]],
  },
  {
    name: "Gmail",
    groups: [
      ["GMAIL_SERVICE_ACCOUNT_JSON"],
      [
        "GMAIL_OAUTH_CLIENT_ID",
        "GMAIL_OAUTH_CLIENT_SECRET",
        "GMAIL_OAUTH_REFRESH_TOKEN",
      ],
    ],
  },
  { name: "Notion", groups: [["NOTION_API_KEY"]] },
  { name: "Amazon SP-API", groups: [["AMAZON_SP_REFRESH_TOKEN"]] },
  { name: "Slack", groups: [["SLACK_WEBHOOK_ALERTS"]] },
  { name: "NextAuth", groups: [["NEXTAUTH_SECRET", "NEXTAUTH_URL"]] },
];

function isSet(key: string): boolean {
  if (key === "NOTION_API_KEY") {
    return Boolean(getNotionApiKey());
  }
  return Boolean(String(process.env[key] || "").trim());
}

export function checkIntegrations(): IntegrationStatus[] {
  return DEFINITIONS.map((def) => {
    const keySet = new Set<string>();
    for (const group of def.groups) {
      for (const key of group) keySet.add(key);
    }

    const envVars = [...keySet].map((key) => ({ key, set: isSet(key) }));
    const configured = def.groups.some((group) => group.every((key) => isSet(key)));

    return {
      name: def.name,
      configured,
      envVars,
    };
  });
}
