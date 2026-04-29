import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Shared US map SVG used in supply-chain sections on /go, /wholesale,
// and any other surface that wants to visualize the 5 active states.
//
// The SVG's internal <defs><style> block is stripped at read-time because
// Next 15's SSR + client hydration encode <style> inside
// dangerouslySetInnerHTML inconsistently — the resulting mismatch throws a
// hydration error. Each consumer page must recreate the equivalent styles
// in its own CSS (default state fill, border colors, etc.) and add its own
// active-state highlight selectors.
//
// File is read at module init time (server-side only). Vercel SSG inlines
// the result during build, so there's no runtime cost.

export const US_MAP_SVG = readFileSync(
  resolve(process.cwd(), "public/us-map-states.svg"),
  "utf8",
).replace(/<defs>[\s\S]*?<\/defs>/, "");
