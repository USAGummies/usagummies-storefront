import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const SYSTEM_PROMPT_VERSION = "15.1";

function computePromptHash(): string {
  try {
    const promptSource = readFileSync(
      path.join(process.cwd(), "src/lib/ops/abra-system-prompt.ts"),
      "utf8",
    );
    return `sha256:${createHash("sha256").update(promptSource).digest("hex")}`;
  } catch {
    return "sha256:unavailable";
  }
}

export const SYSTEM_PROMPT_HASH = computePromptHash();

export function getPromptVersion(): {
  version: string;
  hash: string;
  lastUpdated: string;
} {
  return {
    version: SYSTEM_PROMPT_VERSION,
    hash: SYSTEM_PROMPT_HASH,
    lastUpdated: "2026-03-26",
  };
}
