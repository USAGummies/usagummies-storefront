/**
 * GET /api/content-factory/reject?id=<imageId>&token=<secret>&reason=<text>
 *
 * Marks a generated image as REJECTED. Same handler logic as /approve —
 * we just delegate to it. The decision is determined by the URL path.
 */

export { GET } from "../approve/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
