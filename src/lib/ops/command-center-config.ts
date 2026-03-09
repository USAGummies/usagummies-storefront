function parsePositiveInt(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseNotionId(raw: string): string {
  return raw.replace(/-/g, "").toLowerCase();
}

function isNotionId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

type ConfigValidation = {
  ok: boolean;
  errors: string[];
};

export type CommandCenterConfig = {
  b2bSendFloorPerDay: number;
  distributorSendFloorPerDay: number;
  distributorProspectsDbId: string;
  inderbitzinPageId: string;
  validation: ConfigValidation;
};

export function getCommandCenterConfig(): CommandCenterConfig {
  const rawDistributorDbId = String(process.env.COMMAND_CENTER_DISTRIBUTOR_DB_ID || "").trim();
  const rawInderbitzinPageId = String(process.env.COMMAND_CENTER_INDERBITZIN_PAGE_ID || "").trim();
  const distributorProspectsDbId = parseNotionId(rawDistributorDbId);
  const inderbitzinPageId = parseNotionId(rawInderbitzinPageId);

  const errors: string[] = [];
  if (!rawDistributorDbId) {
    errors.push("COMMAND_CENTER_DISTRIBUTOR_DB_ID is missing");
  }
  if (!rawInderbitzinPageId) {
    errors.push("COMMAND_CENTER_INDERBITZIN_PAGE_ID is missing");
  }
  if (!isNotionId(distributorProspectsDbId)) {
    errors.push("COMMAND_CENTER_DISTRIBUTOR_DB_ID is invalid (expected 32-char Notion ID)");
  }
  if (!isNotionId(inderbitzinPageId)) {
    errors.push("COMMAND_CENTER_INDERBITZIN_PAGE_ID is invalid (expected 32-char Notion ID)");
  }

  return {
    b2bSendFloorPerDay: parsePositiveInt("B2B_SEND_FLOOR_PER_DAY", 35),
    distributorSendFloorPerDay: parsePositiveInt("DISTRIBUTOR_SEND_FLOOR_PER_DAY", 10),
    distributorProspectsDbId,
    inderbitzinPageId,
    validation: {
      ok: errors.length === 0,
      errors,
    },
  };
}
