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
// 2026-04-30 mobile-fix: the source SVG ships with hardcoded width="959"
// height="593" but NO viewBox. Without a viewBox, CSS `width: 100%` shrinks
// the SVG box but the inner paths stay at their native 0–959 pixel coords,
// which clips the East Coast off the visible canvas on narrow viewports
// (Ben's bug report from /go on mobile). Fix: inject viewBox="0 0 959 593"
// and strip the fixed width/height so CSS controls the size and the inner
// paths scale proportionally.
//
// File is read at module init time (server-side only). Vercel SSG inlines
// the result during build, so there's no runtime cost.

const raw = readFileSync(
  resolve(process.cwd(), "public/us-map-states.svg"),
  "utf8",
);

export const US_MAP_SVG = raw
  // Strip the embedded stylesheet block (recreated per-consumer in CSS).
  .replace(/<defs>[\s\S]*?<\/defs>/, "")
  // Inject a viewBox + remove fixed pixel size so the SVG scales fluidly.
  // Match either width=… first or height=… first; rebuild as a deterministic,
  // CSS-controllable shape.
  .replace(
    /<svg([^>]*?)\swidth="(\d+(?:\.\d+)?)"([^>]*?)\sheight="(\d+(?:\.\d+)?)"/,
    (_match, before, w, mid, h) =>
      `<svg${before}${mid} viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"`,
  )
  .replace(
    /<svg([^>]*?)\sheight="(\d+(?:\.\d+)?)"([^>]*?)\swidth="(\d+(?:\.\d+)?)"/,
    (_match, before, h, mid, w) =>
      `<svg${before}${mid} viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"`,
  );
