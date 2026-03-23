"""
Add a gold outline to the 'GUMMIES' text only in logo-full.png.
Uses the same gold as the wing outline trim (~rgb(197, 163, 100)).
Does NOT touch the red "Made in the U.S.A." text.

Strategy:
1. Identify dark navy pixels (GUMMIES text) in the mid-section of the image
2. Exclude the bottom portion where "Made in the U.S.A." lives
3. Create a dilated mask and fill with gold behind the original text
"""

from PIL import Image, ImageFilter, ImageChops
import numpy as np

# Load original (use the backup, not the already-modified file)
img = Image.open('/Users/ben/usagummies-storefront/public/brand/logo-full-original.png').convert('RGBA')
w, h = img.size
arr = np.array(img)

# The gold color from the wing outline (sampled from the logo)
GOLD = (197, 163, 100, 255)

# Identify dark navy pixels: the GUMMIES text color is ~rgb(18, 28, 61)
r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
navy_mask = (r < 60) & (g < 50) & (b < 90) & (a > 200)

# GUMMIES text lives between ~38% and ~86% of image height
# Navy pixels end at ~84%, red "Made in U.S.A." is below that
y_top = int(h * 0.38)
y_bottom = int(h * 0.86)
gummies_band = np.zeros_like(navy_mask)
gummies_band[y_top:y_bottom, :] = True

# Only navy text in the GUMMIES band
text_mask = navy_mask & gummies_band

# Create a binary mask image for dilation
mask_img = Image.fromarray((text_mask * 255).astype(np.uint8), mode='L')

# Dilate the mask to create the outline area
OUTLINE_WIDTH = 3
dilated = mask_img
for _ in range(OUTLINE_WIDTH):
    dilated = dilated.filter(ImageFilter.MaxFilter(3))

# The outline is the dilated area minus the original text
outline_only = ImageChops.subtract(dilated, mask_img)

# Create the gold outline layer
outline_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
outline_arr = np.array(outline_layer)
outline_mask_arr = np.array(outline_only)
outline_arr[outline_mask_arr > 128] = GOLD
outline_layer = Image.fromarray(outline_arr)

# Composite: gold outline behind original
result = Image.alpha_composite(outline_layer, img)

# Save
result.save('/Users/ben/usagummies-storefront/public/brand/logo-full-gold-outline.png')
print('Saved logo-full-gold-outline.png')
