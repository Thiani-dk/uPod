#!/usr/bin/env python3
"""Regenerates build/icons/*.png and build/icon.png from the app's logo.

Only needs running if ../assets/icon-only.png changes — the generated
PNGs live in build/ so that installing the desktop entry needs no image
tooling. Requires Pillow (`pip install --user pillow`).

    python3 scripts/make-icons.py
"""
import pathlib
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent.parent
SRC = HERE.parent / "assets" / "icon-only.png"
OUT = HERE / "build" / "icons"
# 16-512: what icon themes look for. The window icon Electron loads
# (build/icon.png) is the 512 — a menu bar or dock scales it down itself.
SIZES = (16, 24, 32, 48, 64, 128, 256, 512)


def main() -> int:
    if not SRC.exists():
        print(f"missing source artwork: {SRC}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(SRC).convert("RGBA")
    for size in SIZES:
        image.resize((size, size), Image.LANCZOS).save(OUT / f"{size}.png")
    image.resize((512, 512), Image.LANCZOS).save(HERE / "build" / "icon.png")
    print(f"wrote {len(SIZES)} icons from {SRC.name} ({image.width}x{image.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
