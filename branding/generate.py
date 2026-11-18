"""Generate every logo / icon / splash asset from the official MPL logo.

    python branding/generate.py            (needs Pillow: pip install pillow)

Source: branding/mpl-logo-source.png — the official logo exactly as supplied. The logo itself is
never redrawn or recoloured: it is only cropped from its white margin, the white area OUTSIDE the
outer ring is made transparent, and it is resized (aspect ratio kept). Outputs are committed, so
the build does not need Python. Re-run after replacing the source file.
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'branding' / 'mpl-logo-source.png'
SPLASH_BG = (11, 11, 11)  # the dark launch background (Android splash + web loader)
ICON_BG = (255, 255, 255)  # the logo is designed on white


def master():
    im = Image.open(SRC).convert('RGBA')
    w, h = im.size
    px = im.load()
    dark = lambda p: p[0] + p[1] + p[2] < 600
    cols = [x for x in range(w) if sum(dark(px[x, y]) for y in range(h)) > 15]
    rows = [y for y in range(h) if sum(dark(px[x, y]) for x in range(w)) > 15]
    box = (cols[0], rows[0], cols[-1] + 1, rows[-1] + 1)
    logo = im.crop(box)
    side = max(logo.size) + 8
    sq = Image.new('RGBA', (side, side), (255, 255, 255, 255))
    sq.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2))
    # Make the white background outside the logo transparent: flood fill from the edges over
    # near-white pixels (the logo's dark outer ring stops the fill), then soften the edge.
    p = sq.load()
    near_white = lambda c: min(c[0], c[1], c[2]) > 222
    seen = bytearray(side * side)
    q = deque()
    for i in range(side):
        for x, y in ((i, 0), (i, side - 1), (0, i), (side - 1, i)):
            if not seen[y * side + x] and near_white(p[x, y]):
                seen[y * side + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        p[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < side and 0 <= ny < side and not seen[ny * side + nx] and near_white(p[nx, ny]):
                seen[ny * side + nx] = 1
                q.append((nx, ny))
    # Anti-aliased rim: light pixels touching the transparent area get partial opacity.
    for y in range(1, side - 1):
        for x in range(1, side - 1):
            r, g, b, a = p[x, y]
            if a and any(p[nx, ny][3] == 0 for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                light = (r + g + b) / 3
                if light > 170:
                    p[x, y] = (r, g, b, max(0, min(255, int((255 - light) * 255 / 85))))
    return sq


def fit(logo, size, scale, bg=None):
    """Logo scaled to `scale` of a `size` square, centred, on `bg` (None = transparent)."""
    canvas = Image.new('RGBA', (size, size), (*bg, 255) if bg else (0, 0, 0, 0))
    n = max(1, round(size * scale))
    canvas.alpha_composite(logo.resize((n, n), Image.LANCZOS), ((size - n) // 2, (size - n) // 2))
    return canvas


def save(img, rel, rgb=False):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    out = img.convert('RGB') if rgb else img
    if path.suffix == '.webp':
        out.save(path, quality=88, method=6)  # web display copies: small, alpha kept
    else:
        out.save(path, optimize=True)
    print(f'{rel}  {img.size[0]}x{img.size[1]}  {path.stat().st_size // 1024} KB')


def main():
    logo = master()
    save(logo, 'branding/mpl-logo.png')
    for app in ('viewer', 'admin', 'led'):
        save(fit(logo, 384, 1), f'apps/{app}/public/brand/mpl-logo.webp')  # loaders, large displays
        save(fit(logo, 128, 1), f'apps/{app}/public/brand/mpl-logo-128.webp')  # headers
        save(fit(logo, 32, 1), f'apps/{app}/public/favicon-32.png')
    # PWA / home screen (viewer)
    save(fit(logo, 192, 0.96), 'apps/viewer/public/icon-192.png')
    save(fit(logo, 512, 0.96), 'apps/viewer/public/icon-512.png')
    save(fit(logo, 512, 0.78, ICON_BG), 'apps/viewer/public/icon-maskable-512.png', rgb=True)  # inside the 80% safe zone
    save(fit(logo, 180, 0.9, ICON_BG), 'apps/viewer/public/apple-touch-icon.png', rgb=True)
    # Android sources for `npx capacitor-assets generate --android`
    save(fit(logo, 1024, 0.92, ICON_BG), 'apps/viewer/assets/icon-only.png', rgb=True)
    save(fit(logo, 1024, 0.6), 'apps/viewer/assets/icon-foreground.png')  # adaptive icon safe zone
    save(Image.new('RGB', (1024, 1024), ICON_BG), 'apps/viewer/assets/icon-background.png')
    for name in ('splash', 'splash-dark'):
        save(fit(logo, 2732, 0.24, SPLASH_BG), f'apps/viewer/assets/{name}.png', rgb=True)


if __name__ == '__main__':
    main()
