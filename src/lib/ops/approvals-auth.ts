import { isCronAuthorized } from "@/lib/ops/abra-auth";

export function hasApprovalsReadAccess(req: Request, sessionEmail?: string | null): boolean {
  if (sessionEmail?.trim()) return true;
  return isCronAuthorized(req);
}
