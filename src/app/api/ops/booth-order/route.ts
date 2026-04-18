/**
 * Booth Order API — /api/ops/booth-order (DEPRECATED ALIAS)
 *
 * Canonical implementation lives in /api/booth-order. This file is kept as a
 * thin alias so any internal callers (scripts, Viktor tooling, etc.) still
 * work during the transition. New clients should POST to /api/booth-order.
 *
 * We redeclare `runtime` and `dynamic` here (rather than re-exporting them)
 * because Next.js needs those configs to be statically analyzable at the
 * route module level.
 */

import { POST as canonicalPost } from "../../booth-order/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = canonicalPost;
