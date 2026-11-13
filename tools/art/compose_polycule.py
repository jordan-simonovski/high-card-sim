#!/usr/bin/env python3
"""The true-ending CG, composited from the finished sprites over the finale sky.

SDXL can't keep three specific character designs straight in one image (attributes bleed
between people), so the polycule CG is built from the on-model sprites instead:

    python3 tools/art/compose_polycule.py public/art
"""
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

art = sys.argv[1]
bg = Image.open(f"{art}/bgs/finale_sky.webp").convert("RGBA")
W, H = bg.size

# One soft shared glow: three people, one wide event.
glow = Image.new("RGBA", bg.size, (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((W * 0.12, H * 0.18, W * 0.88, H * 1.25), fill=(255, 214, 236, 170))
bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(W // 18)))

# Logs left, Traces centre (a step forward), Metrics right; happy/blush faces.
cast = [("logs", "happy", 0.27, 0.92), ("metrics", "blush", 0.73, 0.92), ("traces", "happy", 0.5, 0.98)]
for name, mood, cx, h in cast:
    s = Image.open(f"{art}/sprites/{name}_{mood}.webp").convert("RGBA")
    k = H * h / s.height
    s = s.resize((int(s.width * k), int(s.height * k)), Image.LANCZOS)
    shadow = Image.new("RGBA", s.size, (58, 29, 74, 0))
    shadow.putalpha(s.split()[-1].point(lambda a: a * 0.35))
    x, y = int(W * cx - s.width / 2), H - s.height
    bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)), (x + 10, y + 14))
    bg.alpha_composite(s, (x, y))

# Light particles drifting over everyone.
random.seed(7)
sparks = Image.new("RGBA", bg.size, (0, 0, 0, 0))
d = ImageDraw.Draw(sparks)
for _ in range(140):
    x, y, r = random.uniform(0, W), random.uniform(0, H), random.uniform(2, 7)
    d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 245, 210, random.randint(90, 220)))
bg.alpha_composite(sparks.filter(ImageFilter.GaussianBlur(1.5)))

bg.convert("RGB").save(f"{art}/cgs/polycule.webp", quality=86)
print("wrote", f"{art}/cgs/polycule.webp", bg.size)
