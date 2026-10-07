"""Draw the app icon (a steaming bowl) as PNGs, standard library only.

The bowl sits inside the middle 70% so Android can crop it into a circle.
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'app', 'icons')

BG = (180, 83, 42)
CREAM = (251, 240, 226)


def inside(x, y):
    """x, y in 0..1. Returns True where the cream shape is."""
    # Bowl: lower half of a circle plus a rim.
    cx, cy, r = 0.5, 0.52, 0.27
    if y >= cy and (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
        return True
    if abs(y - cy) <= 0.02 and abs(x - cx) <= r + 0.03:
        return True
    # Foot of the bowl.
    if 0.77 <= y <= 0.81 and abs(x - cx) <= 0.09:
        return True
    # Three wavy steam lines.
    for sx in (0.40, 0.5, 0.60):
        if 0.26 <= y <= 0.44:
            wx = sx + 0.025 * math.sin((y - 0.26) / 0.18 * 2 * math.pi)
            if abs(x - wx) <= 0.017:
                return True
    return False


def draw(size):
    ss = 3
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            hits = sum(inside((px + (i + 0.5) / ss) / size, (py + (j + 0.5) / ss) / size)
                       for i in range(ss) for j in range(ss))
            t = hits / (ss * ss)
            row += bytes(round(BG[k] + (CREAM[k] - BG[k]) * t) for k in range(3))
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'icon-{size}.png'), 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    for s in (192, 512):
        draw(s)
    print('Icons written to', os.path.normpath(OUT))
