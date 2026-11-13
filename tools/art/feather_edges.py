#!/usr/bin/env python3
"""Fade sprite alpha to zero at the left, right and top image borders.

Some renders run hair or coat past the frame, so the matte ends in a hard line at the edge
of the image. A short ramp makes it dissolve instead. The bottom stays hard: sprites stand
on the bottom of the screen.

    python3 tools/art/feather_edges.py public/art/sprites
"""
import glob
import sys

from PIL import Image, ImageChops

RAMP = 48
for path in sorted(glob.glob(f"{sys.argv[1]}/*.webp")):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    ramp = Image.new("L", (w, h), 255)
    px = ramp.load()
    for y in range(h):
        for x in range(w):
            d = min(x, w - 1 - x, y, RAMP)
            if d < RAMP:
                px[x, y] = int(255 * d / RAMP)
    im.putalpha(ImageChops.multiply(im.split()[-1], ramp))
    im.save(path, quality=88)
    print("feathered", path)
