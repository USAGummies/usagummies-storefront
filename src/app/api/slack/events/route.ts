import { POST as handlePOST } from "@/app/api/ops/slack/events/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handlePOST(req);
}
