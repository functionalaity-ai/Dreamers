#!/usr/bin/env python3
"""Generate shaders/textures/noise.png deterministically using only the standard library.

256x256 RGBA8, all channels tile seamlessly:
  R  smooth value noise, 8-texel lattice (quintic interpolation)
  G  smooth value noise, 16-texel lattice
  B  64x64 void-and-cluster blue noise (Ulichney 1993), tiled 4x4
  A  white noise
"""
import math
import random
import struct
import zlib
from pathlib import Path

SIZE = 256
OUT = Path(__file__).resolve().parent.parent / "shaders" / "textures" / "noise.png"


def value_noise(size, cell, rng):
    n = size // cell
    lattice = [[rng.random() for _ in range(n)] for _ in range(n)]

    def fade(t):
        return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)

    out = []
    for y in range(size):
        gy = y / cell
        y0 = int(gy) % n
        y1 = (y0 + 1) % n
        fy = fade(gy - int(gy))
        row = []
        for x in range(size):
            gx = x / cell
            x0 = int(gx) % n
            x1 = (x0 + 1) % n
            fx = fade(gx - int(gx))
            a = lattice[y0][x0] + (lattice[y0][x1] - lattice[y0][x0]) * fx
            b = lattice[y1][x0] + (lattice[y1][x1] - lattice[y1][x0]) * fx
            row.append(a + (b - a) * fy)
        out.append(row)
    # Normalise to the full 0..1 range.
    lo = min(min(r) for r in out)
    hi = max(max(r) for r in out)
    return [[(v - lo) / (hi - lo) for v in r] for r in out]


def void_and_cluster(size, rng, sigma=1.5, initial_fraction=0.1):
    """Return a size x size list of ranks 0..size*size-1 (blue-noise threshold matrix)."""
    count = size * size
    radius = int(math.ceil(sigma * 4))
    kernel = []
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            w = math.exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma))
            kernel.append((dx, dy, w))

    def splat(energy, idx, sign):
        x, y = idx % size, idx // size
        for dx, dy, w in kernel:
            energy[((y + dy) % size) * size + (x + dx) % size] += sign * w

    pattern = [False] * count
    energy = [0.0] * count
    ones = int(count * initial_fraction)
    for idx in rng.sample(range(count), ones):
        pattern[idx] = True
        splat(energy, idx, 1.0)

    def tightest_cluster():
        best, best_e = -1, -1e30
        for i in range(count):
            if pattern[i] and energy[i] > best_e:
                best, best_e = i, energy[i]
        return best

    def largest_void():
        best, best_e = -1, 1e30
        for i in range(count):
            if not pattern[i] and energy[i] < best_e:
                best, best_e = i, energy[i]
        return best

    # Phase 0: relax the initial pattern into a well-spaced one.
    for _ in range(count):
        c = tightest_cluster()
        pattern[c] = False
        splat(energy, c, -1.0)
        v = largest_void()
        if v == c:
            pattern[c] = True
            splat(energy, c, 1.0)
            break
        pattern[v] = True
        splat(energy, v, 1.0)

    rank = [0] * count
    proto = pattern[:]
    proto_energy = energy[:]

    # Phase 1: rank the initial points by removing tightest clusters.
    rank_val = ones - 1
    while rank_val >= 0:
        c = tightest_cluster()
        pattern[c] = False
        splat(energy, c, -1.0)
        rank[c] = rank_val
        rank_val -= 1

    # Phases 2 and 3: fill the largest voids from the prototype.
    pattern = proto
    energy = proto_energy
    rank_val = ones
    while rank_val < count:
        v = largest_void()
        pattern[v] = True
        splat(energy, v, 1.0)
        rank[v] = rank_val
        rank_val += 1

    return [[rank[y * size + x] for x in range(size)] for y in range(size)]


def write_png(path, width, height, rgba_rows):
    raw = bytearray()
    for row in rgba_rows:
        raw.append(0)  # filter type: none
        raw.extend(row)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def main():
    rng = random.Random(0x4B455354)  # "KEST"
    r = value_noise(SIZE, 8, rng)
    g = value_noise(SIZE, 16, rng)
    bn = void_and_cluster(64, rng)
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            b = bn[y % 64][x % 64]
            row.extend((
                int(round(r[y][x] * 255.0)),
                int(round(g[y][x] * 255.0)),
                int(b * 256 // 4096),
                rng.randrange(256),
            ))
        rows.append(bytes(row))
    write_png(OUT, SIZE, SIZE, rows)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
