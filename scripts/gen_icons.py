#!/usr/bin/env python3
"""Generate BreachGuard PNG icons using only the Python standard library.

Why this exists: binary PNGs cannot be committed through the text-only GitHub tooling used
to build this repo, so icons are rendered from code instead (CI runs this before tests and
before the Android build). Output is deterministic.

    python3 scripts/gen_icons.py              # (re)generate everything
    python3 scripts/gen_icons.py --if-missing # skip when all outputs already exist

Outputs
  www/icons/icon-192.png, icon-512.png, maskable-512.png
  android-res/res/mipmap-*/ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png
  android-res/res/drawable-nodpi/splash_logo.png
"""
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BG = (11, 16, 32)
C1, C2 = (124, 92, 255), (20, 184, 200)
SHIELD = [(64, 14), (106, 31), (106, 62), (96, 86), (80, 104), (64, 114), (48, 104), (32, 86), (22, 62), (22, 31)]
CHECK = [(45, 63), (58, 76), (84, 47)]
CHECK_R = 4.5  # half of 9-unit stroke


def _cross_sign_ok(px, py):
    """True if (px,py) is inside the convex SHIELD polygon (clockwise winding in screen space)."""
    n = len(SHIELD)
    for i in range(n):
        x1, y1 = SHIELD[i]
        x2, y2 = SHIELD[(i + 1) % n]
        if (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1) < 0:
            return False
    return True


def _dist_seg(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def _in_check(x, y):
    return min(_dist_seg(x, y, CHECK[0], CHECK[1]), _dist_seg(x, y, CHECK[1], CHECK[2])) <= CHECK_R


def _in_round_rect(u, v, r=28.0):
    cx = min(max(u, r), 128 - r)
    cy = min(max(v, r), 128 - r)
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r


def render(size, scale=1.0, bg="none"):
    """Render a size x size RGBA image. bg: 'none' | 'rounded' | 'round' | 'full'."""
    ss = 3 if size <= 200 else 2
    out = bytearray()
    for py in range(size):
        row = bytearray([0])  # PNG filter type 0
        for px in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    u = (px + (sx + 0.5) / ss) / size * 128.0  # canvas coords (0..128)
                    v = (py + (sy + 0.5) / ss) / size * 128.0
                    x = 64 + (u - 64) / scale  # artwork coords
                    y = 64 + (v - 64) / scale
                    if _cross_sign_ok(x, y):
                        if _in_check(x, y):
                            r, g, b = 255, 255, 255
                        else:
                            t = (x + y) / 256.0
                            r, g, b = (C1[i] + (C2[i] - C1[i]) * t for i in range(3))
                        a = 1.0
                    elif (bg == "full") or (bg == "rounded" and _in_round_rect(u, v)) or \
                         (bg == "round" and (u - 64) ** 2 + (v - 64) ** 2 <= 64 * 64):
                        r, g, b = BG
                        a = 1.0
                    else:
                        continue
                    ar += r * a
                    ag += g * a
                    ab += b * a
                    aa += a
            n = ss * ss
            if aa == 0:
                row += b"\x00\x00\x00\x00"
            else:
                row += bytes((int(ar / aa + 0.5), int(ag / aa + 0.5), int(ab / aa + 0.5), int(255 * aa / n + 0.5)))
        out += row
    return size, bytes(out)


def write_png(path: Path, size: int, raw: bytes):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def outputs():
    res = ROOT / "android-res" / "res"
    items = [
        (ROOT / "www/icons/icon-192.png", 192, 1.0, "rounded"),
        (ROOT / "www/icons/icon-512.png", 512, 1.0, "rounded"),
        (ROOT / "www/icons/maskable-512.png", 512, 0.62, "full"),  # artwork inside 80% safe zone
        (res / "drawable-nodpi/splash_logo.png", 288, 0.9, "none"),
    ]
    for d, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        items.append((res / f"mipmap-{d}/ic_launcher.png", px, 1.0, "rounded"))
        items.append((res / f"mipmap-{d}/ic_launcher_round.png", px, 0.92, "round"))
    # Adaptive-icon foreground: 108dp canvas, artwork kept inside the 66dp safe zone.
    for d, px in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
        items.append((res / f"mipmap-{d}/ic_launcher_foreground.png", px, 0.55, "none"))
    return items


def main(argv):
    items = outputs()
    if "--if-missing" in argv and all(p.exists() for p, *_ in items):
        print("icons present; skipping")
        return 0
    for path, size, scale, bg in items:
        s, raw = render(size, scale, bg)
        write_png(path, s, raw)
    print(f"generated {len(items)} icons")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
