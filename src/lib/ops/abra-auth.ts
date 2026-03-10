import { auth } from "@/lib/auth/config";

export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const authHeader = req.headers.get("authorization")?.trim();
  if (!authHeader) return false;

  return authHeader === `Bearer ${secret}`;
}

export async function isAuthorized(req: Request): Promise<boolean> {
  try {
    const session = await auth();
    if (session?.user?.email) return true;
  } catch {
    // auth() may not be available in cron contexts
  }

  return isCronAuthorized(req);
}
