import { timingSafeEqual } from "node:crypto";

import { isAuthorized } from "@/lib/ops/abra-auth";

export const OPENAI_WORKSPACE_CONNECTOR_SECRET =
  "OPENAI_WORKSPACE_CONNECTOR_SECRET" as const;

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hasOpenAIWorkspaceBearer(req: Request): boolean {
  const expected = nonEmpty(process.env[OPENAI_WORKSPACE_CONNECTOR_SECRET]);
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;

  return safeEquals(match[1].trim(), expected);
}

export async function isOpenAIWorkspaceAuthorized(req: Request): Promise<boolean> {
  if (await isAuthorized(req)) return true;
  return hasOpenAIWorkspaceBearer(req);
}
