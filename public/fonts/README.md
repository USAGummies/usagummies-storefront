# Brand Fonts — Zuume + Rosseville

Per Ben's typography spec (2026-04-25), USA Gummies' canonical brand fonts are:

| Role | Family | Foundry | Weights | Usage |
|---|---|---|---|---|
| **The Headliner** | **Zuume** | Spectral Type | Variable, 100–900 | Headlines, subheadlines, titling, body |
| **American Accent** | **Rosseville** | (TBD) | Single | Script accent, 10–30% sparingly only |

## Drop the licensed files here

```
public/fonts/zuume/Zuume-Variable.woff2     (variable font, full weight axis)
public/fonts/rosseville/Rosseville.woff2    (single weight)
```

If your licensed files have different filenames, either rename them to match
the paths above OR update the `@font-face` `src` URLs in
`src/app/globals.css` (search for `Zuume` / `Rosseville`).

## Activate the fonts

After dropping the files in, **uncomment the `@font-face` block** in
`src/app/globals.css` (it's the first block under the imports — currently
wrapped in `/* ... */`). Once uncommented, the font-family stacks across
the site already prefer `"Zuume"` and `"Rosseville"` first, so they'll
take over from the Anton / Inter / Allison Google Fonts fallbacks
automatically — no other code changes needed.

## Currently active fallbacks

Until the real fonts are in place, the site renders with these Google Fonts
(loaded via `src/app/layout.tsx`):

- **Anton** — Zuume display fallback (tall condensed bold sans, single weight)
- **Inter** — Zuume body fallback (clean modern sans, full weight range)
- **Allison** — Rosseville script fallback (casual handwritten script)

## Adobe Fonts alternative

If Zuume / Rosseville are licensed via Adobe Fonts (Typekit) instead of
self-hosted, replace the `@font-face` block in `globals.css` with:

```html
<link rel="stylesheet" href="https://use.typekit.net/<KIT-ID>.css">
```

added to `src/app/layout.tsx` `<head>`.
