export type ApPacketAttachmentStatus = "ready" | "optional" | "missing" | "review";

export type ApPacketAttachment = {
  id: string;
  label: string;
  status: ApPacketAttachmentStatus;
  note: string;
  driveUrl?: string;
};

export type ApPacketCatalogRow = {
  vendorItemNumber: string;
  description: string;
  size: string;
  unitUpc: string;
  caseUpc: string;
  masterCartonUpc: string;
  casePack: number;
  caseCost: number;
  unitWholesalePrice: number;
  srpRange: string;
  minOrder: string;
  shelfLife: string;
  sourceNote: string;
};

export type ApPacketField = {
  label: string;
  value: string;
  note?: string;
};

export type ApPacket = {
  slug: string;
  accountName: string;
  apEmail: string;
  requestedAt: string;
  dueWindow: string;
  owner: string;
  pricingNeedsReview: boolean;
  status: "action-required" | "ready-to-send";
  companyProfile: {
    legalCompanyName: string;
    dba: string;
    ein: string;
    remitToAddress: string;
    website: string;
    companyPhone: string;
    apEmail: string;
    salesEmail: string;
    paymentTerms: string;
    paymentMethods: string;
    poRequirement: string;
    achRouting: string;
    wireRouting: string;
    bankName: string;
    accountName: string;
  };
  retailerRequirements: string[];
  fieldMap: ApPacketField[];
  attachments: ApPacketAttachment[];
  catalog: ApPacketCatalogRow[];
  nextActions: string[];
  replyDraft: {
    subject: string;
    body: string;
  };
  sources: string[];
};

const JUNGLE_JIMS_PACKET: ApPacket = {
  slug: "jungle-jims",
  accountName: "Jungle Jim's Market",
  apEmail: "accounting@junglejims.com",
  requestedAt: "2026-04-20",
  dueWindow: "Return packet by end of week",
  owner: "Rene Gonzalez",
  pricingNeedsReview: false,
  status: "ready-to-send",
  companyProfile: {
    legalCompanyName: "USA Gummies, LLC",
    dba: "USA Gummies",
    ein: "33-4744824",
    remitToAddress: "1309 Coffeen Ave, Ste 1200, Sheridan, WY 82801-5777",
    website: "www.usagummies.com",
    companyPhone: "(307) 209-4928",
    apEmail: "ben@usagummies.com",
    salesEmail: "ben@usagummies.com",
    paymentTerms: "Due on Receipt / Net 10 (per invoice)",
    paymentMethods: "ACH, check, wire",
    poRequirement: "PO number required on all invoices",
    achRouting: "125000024",
    wireRouting: "026009593",
    bankName: "Bank of America",
    accountName: "Business Adv Fundamentals",
  },
  retailerRequirements: [
    "Completed Vendor & Contractor Setup / Update Form.",
    "Signed current W-9 with tax classification.",
    "Optional ACH enrollment form if Jungle Jim's will pay by ACH.",
    "Item list / catalog with UPC or EAN, item description, size, case pack, case cost, and item number.",
    "Return packet to accounting@junglejims.com or fax 513-674-6049.",
  ],
  fieldMap: [
    { label: "Legal company name", value: "USA Gummies, LLC", note: "Use CIF-001 / W-9 naming, not older buyer-email shorthand." },
    { label: "DBA / trade name", value: "USA Gummies" },
    { label: "Federal tax ID", value: "33-4744824" },
    { label: "Remit-to address", value: "1309 Coffeen Ave, Ste 1200, Sheridan, WY 82801-5777" },
    { label: "Primary AP / AR email", value: "ben@usagummies.com", note: "Per Rene finance doctrine in Slack." },
    { label: "Primary phone", value: "(307) 209-4928", note: "Company number only." },
    { label: "Website", value: "www.usagummies.com" },
    { label: "Payment terms", value: "Due on Receipt / Net 10", note: "CIF-001 and Slack doctrine." },
    { label: "Accepted payment methods", value: "ACH, check, wire" },
    { label: "PO required", value: "Yes — on all invoices" },
    { label: "ACH notification email", value: "ben@usagummies.com" },
    { label: "Bank name", value: "Bank of America" },
    { label: "ACH / paper routing", value: "125000024" },
    { label: "Wire routing", value: "026009593" },
    { label: "Bank account name", value: "Business Adv Fundamentals" },
  ],
  attachments: [
    {
      id: "vendor-setup-form",
      label: "Jungle Jim's completed Vendor & Contractor Setup Form",
      status: "ready",
      note: "Completed outbound PDF staged locally for today's Jungle Jim's reply packet.",
    },
    {
      id: "w9",
      label: "Signed W-9",
      status: "ready",
      note: "Drive file verified.",
      driveUrl: "https://drive.google.com/file/d/1E0ITe1moy55eZA24y9ToIWNvH5oDQZgL/view?usp=drive_link",
    },
    {
      id: "cif",
      label: "CIF-001 Customer Information Form",
      status: "ready",
      note: "Contains remit-to, ACH, key contacts, and invoice requirements.",
      driveUrl: "https://drive.google.com/file/d/1NJcP4y1-znc1iKxXfEkrC1C2sLm2gGrw/view?usp=drive_link",
    },
    {
      id: "item-list",
      label: "Retailer AP item list / catalog",
      status: "ready",
      note: "Generated from current verified product and UPC data for Jungle Jim's.",
      driveUrl: "https://docs.google.com/spreadsheets/d/1K7WotKlEEMbI4x4pdqjg1xAd83PoRtJfUM7IXVTVIJ8/edit?usp=drivesdk",
    },
    {
      id: "sell-sheet",
      label: "Distributor sell sheet",
      status: "optional",
      note: "Useful backup product spec sheet for AP / item setup.",
      driveUrl: "https://drive.google.com/file/d/1RXO5VHQHKt6Aq2KqJ8dcnfzk8yr6fcUf/view?usp=drive_link",
    },
    {
      id: "ach-form",
      label: "Jungle Jim's ACH enrollment form",
      status: "optional",
      note: "Optional. Hold until Jungle Jim's wants ACH activated and any required bank support document is attached.",
    },
  ],
  catalog: [
    {
      vendorItemNumber: "AAGB-7.5",
      description: "All American Gummy Bears — Natural Colors, No Artificial Dyes, Made in USA",
      size: "7.5 oz (213g)",
      unitUpc: "1-99284-62470-2",
      caseUpc: "1-99284-71553-0",
      masterCartonUpc: "1-99284-37324-2",
      casePack: 6,
      caseCost: 20.94,
      unitWholesalePrice: 3.49,
      srpRange: "$4.99-$6.49",
      minOrder: "1 master carton (36 bags / 6 cases)",
      shelfLife: "18 months",
      sourceNote: "Case cost locked by Ben on 2026-04-23. UPC / EAN values formatted to Jungle Jim's requested hyphenated pattern.",
    },
  ],
  nextActions: [
    "Send the completed Jungle Jim's vendor setup form, signed W-9, CIF-001, and item list from the current Gmail thread.",
    "Use the hyphenated UPC / EAN item list that matches Jungle Jim's requested import pattern.",
    "Only send the ACH enrollment form if Jungle Jim's wants ACH activated now and any required bank support document is ready.",
    "Monitor the accounting reply and mirror the final packet outcome into finance records.",
  ],
  replyDraft: {
    subject: "Re: Jungle Jim's Market New Account Setup Forms",
    body: [
      "Hi Jungle Jim's Accounting Team,",
      "",
      "Thank you for sending the new account setup forms.",
      "",
      "Attached are our completed Vendor and Contractor Setup / Update Form, our signed W-9, our customer information form, and our item list / catalog for All American Gummy Bears.",
      "",
      "For reference, our current item setup details are:",
      "- Vendor item number: AAGB-7.5",
      "- Description: All American Gummy Bears",
      "- Size: 7.5 oz (213g)",
      "- UPC / EAN: 1-99284-62470-2",
      "- Case pack: 6",
      "- Current quoted case cost: $20.94",
      "",
      "If you would like ACH activated now as well, let us know and we can send the ACH enrollment page with any supporting bank document you require.",
      "",
      "Best,",
      "Ben Stutman",
      "USA Gummies",
      "ben@usagummies.com",
      "(307) 209-4928",
    ].join("\n"),
  },
  sources: [
    "Drive: CIF-001 Customer Information Form",
    "Drive: USA Gummies W-9 2026",
    "Drive: Distributor Sell Sheet v3",
    "Slack #financials: Rene doctrine edits (2026-04-12)",
    "Slack #financials: Jungle Jim's AP packet note (2026-04-20)",
    "Gmail: Jungle Jim's AP request thread",
  ],
};

export function listApPackets(): ApPacket[] {
  return [JUNGLE_JIMS_PACKET];
}

export function getApPacket(slug: string): ApPacket | null {
  return listApPackets().find((packet) => packet.slug === slug) ?? null;
}

export function buildCatalogCsv(packet: ApPacket): string {
  const header = [
    "Vendor Item Number",
    "Item Description",
    "Size",
    "UPC / EAN",
    "Case UPC",
    "Master Carton UPC",
    "Case Pack",
    "Case Cost",
    "Unit Wholesale Price",
    "MSRP Range",
    "Minimum Order",
    "Shelf Life",
    "Source Note",
  ];

  const rows = packet.catalog.map((row) => [
    row.vendorItemNumber,
    row.description,
    row.size,
    row.unitUpc,
    row.caseUpc,
    row.masterCartonUpc,
    String(row.casePack),
    row.caseCost.toFixed(2),
    row.unitWholesalePrice.toFixed(2),
    row.srpRange,
    row.minOrder,
    row.shelfLife,
    row.sourceNote,
  ]);

  const escape = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
  return [header, ...rows].map((cols) => cols.map(escape).join(",")).join("\n");
}
