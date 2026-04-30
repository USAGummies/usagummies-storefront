#!/usr/bin/env python3
"""
Generate 4 USA Gummies testimonial ad cards (1080x1080 PNG, IG Feed format)
using PIL (Pillow). Ben's directive 2026-04-30:

  "build 4 new meta ads, using their reviews as the imagery, with our logo
   and branding of course, and use the promo as the copy. Craig is buying
   more, you can too, today buy 4 get 1 free... or something like that."

Each card pairs ONE real verified-buyer 5-star review with the active
Buy-4-Get-1-Free promo. Cards are saved to:
  public/brand/ad-assets-testimonials/

Usage:
  python3 scripts/generate-testimonial-ads.py
"""
import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Installing Pillow...")
    os.system("pip3 install Pillow >/dev/null 2>&1")
    from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "public" / "brand" / "ad-assets-testimonials"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Brand palette (matches /go LP)
NAVY = (27, 42, 74)        # var(--lp-ink)
RED = (199, 54, 44)        # var(--lp-red)
GOLD = (199, 160, 98)      # var(--lp-gold)
CREAM = (248, 245, 239)    # var(--lp-cream)
OFF_WHITE = (255, 252, 246)
INK_DIM = (95, 91, 86)

W, H = 1080, 1080  # IG Feed square

# Real verified-buyer 5-star reviews (Vine excluded per Ben directive).
# Quote shortened/condensed for readability at ad scale where needed.
TESTIMONIALS = [
    {
        "key": "tommie_outstanding",
        "hook": "Tommie is ordering more.",
        "quote": "They are outstanding, I will\norder more in the future.",
        "name": "Tommie O.",
        "you_too": "You can too.",
    },
    {
        "key": "craig_will_reorder",
        "hook": "Craig is reordering regularly.",
        "quote": "Love them gummies,\nwill be ordering regularly.",
        "name": "Craig B.",
        "you_too": "Your turn.",
    },
    {
        "key": "rene_kids",
        "hook": "Rene's kids approve.",
        "quote": "Nice stocking stuffers for\nmy kids! Fresh and very good.",
        "name": "Rene G.",
        "you_too": "Bring some home.",
    },
    {
        "key": "ryan_super_fast",
        "hook": "Ryan got his fast.",
        "quote": "Super fast and easy.",
        "name": "Ryan M.",
        "you_too": "You're next.",
    },
]


def load_font(size, bold=False):
    """Try a few common font paths; fallback to default if missing."""
    # Impact has the bold display look but is missing many glyphs (★, 🇺🇸).
    # Use Helvetica/SFNS for general text (full Unicode coverage), reserve
    # Impact only when explicitly requested via bold=True.
    bold_candidates = [
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
    ]
    regular_candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/SFNS.ttf",
    ]
    for p in (bold_candidates if bold else regular_candidates):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_star(draw, cx, cy, r, fill):
    """Draw a 5-point star polygon centered at (cx, cy) with radius r."""
    import math
    points = []
    for i in range(10):
        angle = math.pi / 2 + i * math.pi / 5
        radius = r if i % 2 == 0 else r * 0.4
        points.append((cx + radius * math.cos(angle), cy - radius * math.sin(angle)))
    draw.polygon(points, fill=fill)


def draw_star_row(draw, cy, count, r, gap, fill):
    """Draw `count` stars centered horizontally at vertical center cy."""
    total_w = count * (r * 2) + (count - 1) * gap
    start_x = (W - total_w) // 2 + r
    for i in range(count):
        cx = start_x + i * (r * 2 + gap)
        draw_star(draw, cx, cy, r, fill)


def draw_centered_text(draw, text, y, font, fill, max_width=None, line_spacing=1.15):
    """Draw multi-line text centered horizontally; return next y after the block."""
    lines = text.split("\n")
    line_height = font.size * line_spacing
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (W - text_w) // 2
        draw.text((x, y + i * line_height), line, font=font, fill=fill)
    return int(y + len(lines) * line_height)


def make_card(t):
    img = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(img)

    # Top bunting strip (red)
    draw.rectangle([(0, 0), (W, 14)], fill=RED)
    # Bottom CTA bar
    cta_h = 220
    draw.rectangle([(0, H - cta_h), (W, H)], fill=NAVY)
    # CTA accent stripe
    draw.rectangle([(0, H - cta_h), (W, H - cta_h + 8)], fill=RED)

    # Fonts — bold=True hits Impact for display, =False uses Helvetica for body/Unicode
    label_font = load_font(28, bold=True)
    hook_font = load_font(60, bold=True)
    quote_font = load_font(76, bold=True)
    name_font = load_font(36)
    you_font = load_font(72, bold=True)
    cta_font = load_font(76, bold=True)
    cta_sub_font = load_font(34)

    # Eyebrow with star drawn glyph (skip Unicode stars that don't render in Impact)
    draw_star(draw, 360, 75, 14, RED)
    draw_centered_text(draw, "REAL VERIFIED BUYER", 60, label_font, RED)
    draw_star(draw, W - 360, 75, 14, RED)

    # Hook ("Tommie is ordering more.")
    y = draw_centered_text(draw, t["hook"], 110, hook_font, NAVY)

    # Quote (the heart of the ad)
    y += 40
    y = draw_centered_text(draw, '"' + t["quote"] + '"', y, quote_font, NAVY, line_spacing=1.2)

    # 5 stars (drawn polygons, not Unicode)
    y += 30
    draw_star_row(draw, y + 25, count=5, r=24, gap=14, fill=GOLD)
    y += 70

    # Author
    draw_centered_text(draw, "— " + t["name"], y, name_font, INK_DIM)
    y += 60

    # "You can too." identity-shift line
    you_y = H - cta_h - 100
    draw_centered_text(draw, t["you_too"], you_y, you_font, RED)

    # Bottom CTA (white text on navy)
    cta_y = H - cta_h + 50
    draw_centered_text(draw, "BUY 4. GET 1 FREE.", cta_y, cta_font, OFF_WHITE)
    draw_centered_text(draw, "$23.96  ·  5-PACK  ·  FREE SHIPPING", cta_y + 95, cta_sub_font, (255, 255, 255))

    return img


def main():
    print(f"USA Gummies — testimonial card generator")
    print(f"Output: {OUT_DIR}")
    print()
    for t in TESTIMONIALS:
        img = make_card(t)
        out = OUT_DIR / f"testimonial_{t['key']}_1080.png"
        img.save(out, "PNG", quality=95)
        print(f"  ✓ {out.name}")
    print(f"\n{len(TESTIMONIALS)} cards generated.")


if __name__ == "__main__":
    main()
