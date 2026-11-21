"""
Faisselle's mark and wordmark, drawn from the app's own font (Bricolage Grotesque SemiBold, bundled), and every file
made from them: src/shared/logo.ts (the paths the app draws), build/icon.svg, logo.svg, wordmark.svg, the app icon
(icon.png, icon.icns, icons/*.png) and the menu bar / tray icons (resources/tray*.png).

Run again after changing the design:
  python3 -m venv /tmp/brand && /tmp/brand/bin/pip install fonttools==4.55.3 pillow==11.0.0
  /tmp/brand/bin/python app/scripts/brand.py
"""
import re
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter

APP = Path(__file__).resolve().parent.parent
FONT = TTFont(APP / 'src/renderer/src/assets/bricolage-grotesque.ttf')
CMAP = FONT.getBestCmap()
GLYPHS = FONT.getGlyphSet()
ACCENT = (0x71, 0x42, 0xE8, 255)
TOP, MID, BOTTOM = (0x8F, 0x38, 0xFF), (0x6F, 0x00, 0xFF), (0x5B, 0x00, 0xD1)


def glyph(ch):
    return GLYPHS[CMAP[ord(ch)]]


def bounds(name):
    from fontTools.pens.boundsPen import BoundsPen
    pen = BoundsPen(GLYPHS)
    GLYPHS[name].draw(pen)
    return pen.bounds


def path(draw, transform):
    """an SVG path of what draw() draws, through an affine transform (a, b, c, d, e, f)"""
    pen = SVGPathPen(GLYPHS, ntos=lambda v: f'{v:.3f}'.rstrip('0').rstrip('.'))
    draw(TransformPen(pen, transform))
    return pen.getCommands()


# ---------- the mark: a lowercase f, filling a 100 × 100 box (y down) ----------
F = CMAP[ord('f')]
x0, y0, x1, y1 = bounds(F)
scale = 84 / max(x1 - x0, y1 - y0)
dx = (100 - (x1 - x0) * scale) / 2 - x0 * scale
dy = (100 + (y1 - y0) * scale) / 2 + y0 * scale
MARK = path(lambda p: GLYPHS[F].draw(p), (scale, 0, 0, -scale, dx, dy))

# ---------- the word: "faisselle" in font units (y up), as Logo.tsx flips it ----------
def word_draw(p):
    x = 0
    for ch in 'faisselle':
        g = glyph(ch)
        g.draw(TransformPen(p, (1, 0, 0, 1, x, 0)))
        x += g.width
WORD = path(word_draw, (1, 0, 0, 1, 0, 0))
WORD_WIDTH = sum(glyph(ch).width for ch in 'faisselle')
# Logo.tsx: the mark at 0..65, the word from x=82 at a 0.068 scale; the viewBox is as wide as both
WORDMARK_WIDTH = round(82 + WORD_WIDTH * 0.068 + 4)

logo_ts = APP / 'src/shared/logo.ts'
src = logo_ts.read_text()
src = re.sub(r"export const MARK = '[^']*'", f"export const MARK = '{MARK}'", src)
src = re.sub(r"export const WORD = '[^']*'", f"export const WORD = '{WORD}'", src)
src = re.sub(r"export const WORDMARK_WIDTH = \d+", f"export const WORDMARK_WIDTH = {WORDMARK_WIDTH}", src)
if 'WORDMARK_WIDTH' not in src:
    src += f"\n/** the wordmark's viewBox width, for its 80 high: the mark, then the word */\nexport const WORDMARK_WIDTH = {WORDMARK_WIDTH}\n"
logo_ts.write_text(src)

# ---------- SVGs ----------
(APP / 'build/logo.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#7142E8" d="{MARK}"/></svg>\n')
(APP / 'build/wordmark.svg').write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WORDMARK_WIDTH} 80">'
    f'<path fill="#7142E8" transform="translate(0 5) scale(.65)" d="{MARK}"/>'
    f'<path fill="#1F1F24" transform="translate(82 55) scale(.068 -.068)" d="{WORD}"/></svg>\n')
(APP / 'build/icon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><linearGradient id="face" x1="0" y1="0" x2=".25" y2="1">'
    '<stop stop-color="#8f38ff"/><stop offset=".45" stop-color="#6F00FF"/><stop offset="1" stop-color="#5b00d1"/></linearGradient></defs>'
    '<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#face)"/>'
    f'<path fill="#fff" transform="translate(262 262) scale(5)" d="{MARK}"/></svg>\n')


# ---------- raster: the mark's outline as polygons, drawn large then scaled down (smooth edges) ----------
class FlattenPen(BasePen):
    """the outline as point lists: fontTools splits TrueType's implied on-curve points, this only flattens curves"""
    def __init__(self, glyphset, steps=24):
        super().__init__(glyphset)
        self.polys, self.cur, self.steps = [], [], steps
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, c1, c2, b):
        a = self._getCurrentPoint()
        for i in range(1, self.steps + 1):
            t = i / self.steps
            self.cur.append(tuple((1 - t) ** 3 * a[j] + 3 * (1 - t) ** 2 * t * c1[j] + 3 * (1 - t) * t * t * c2[j] + t ** 3 * b[j] for j in (0, 1)))
    def _qCurveToOne(self, c, b):
        a = self._getCurrentPoint()
        for i in range(1, self.steps + 1):
            t = i / self.steps
            self.cur.append(tuple((1 - t) ** 2 * a[j] + 2 * (1 - t) * t * c[j] + t * t * b[j] for j in (0, 1)))
    def _closePath(self):
        if self.cur: self.polys.append(self.cur)
        self.cur = []
    _endPath = _closePath


def mark_polygons(size, offset=(0, 0), box=100):
    """the mark's contours as point lists, for a box of `size` pixels at offset"""
    pen = FlattenPen(GLYPHS)
    GLYPHS[F].draw(TransformPen(pen, (scale, 0, 0, -scale, dx, dy)))
    k = size / box
    return [[(offset[0] + x * k, offset[1] + y * k) for x, y in p] for p in pen.polys]


def draw_mark(img, size, offset, fill):
    """the mark in one colour, even-odd (the f has no holes, but a design change might)"""
    from PIL import ImageChops
    mask = Image.new('L', img.size, 0)
    for poly in mark_polygons(size, offset):
        one = Image.new('L', img.size, 0)
        ImageDraw.Draw(one).polygon(poly, fill=255)
        mask = ImageChops.logical_xor(mask.convert('1'), one.convert('1')).convert('L')
    img.paste(Image.new('RGBA', img.size, fill), (0, 0), mask)


def icon(px):
    S = 4  # supersampled
    n = px * S
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    # the face: a vertical gradient in a rounded square, with a soft shadow under it
    m, r = round(n * 100 / 1024), round(n * 185 / 1024)
    face = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    grad = Image.new('RGBA', (1, n))
    for y in range(n):
        t = y / max(1, n - 1)
        a, b, u = (TOP, MID, t / .45) if t < .45 else (MID, BOTTOM, (t - .45) / .55)
        grad.putpixel((0, y), tuple(round(a[i] + (b[i] - a[i]) * u) for i in range(3)) + (255,))
    grad = grad.resize((n, n))
    rmask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(rmask).rounded_rectangle((m, m, n - m, n - m), r, fill=255)
    if px >= 64:
        shadow = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((m, m + n * 0.012, n - m, n - m + n * 0.012), r, fill=(40, 0, 90, 90))
        img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(n * 0.012)))
    face.paste(grad, (0, 0), rmask)
    img.alpha_composite(face)
    # the mark, white, centred on the face
    size = n * 500 / 1024
    draw_mark(img, size, ((n - size) / 2, (n - size) / 2), (255, 255, 255, 255))
    return img.resize((px, px), Image.LANCZOS)


big = icon(1024)
big.save(APP / 'build/icon.png')
for s in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
    (big if s == 1024 else icon(s)).save(APP / f'build/icons/{s}x{s}.png')
big.save(APP / 'build/icon.icns', format='ICNS')


def tray(w, h, colour, dot=False):
    S = 8
    img = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0))
    size = h * S * 0.95
    draw_mark(img, size, ((w * S - size) / 2, (h * S - size) / 2), colour)
    if dot:
        d = ImageDraw.Draw(img)
        r = h * S * 0.2
        cx, cy = w * S - r - S * 0.5, h * S - r - S * 0.5
        d.ellipse((cx - r - S, cy - r - S, cx + r + S, cy + r + S), fill=(0, 0, 0, 0))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(0xE5, 0x48, 0x4D, 255))
    return img.resize((w, h), Image.LANCZOS)


# macOS: black template images (the system tints them); elsewhere the colour one, and the recording dot
for name, (w, h), colour, dot in [('tray', (22, 22), (0, 0, 0, 255), False), ('tray-titled', (23, 22), (0, 0, 0, 255), False),
                                  ('tray-color', (16, 16), ACCENT, False), ('tray-recording', (16, 16), ACCENT, True)]:
    tray(w, h, colour, dot).save(APP / f'resources/{name}.png')
    tray(w * 2, h * 2, colour, dot).save(APP / f'resources/{name}@2x.png')
print('mark, wordmark, icons and tray icons written; wordmark width', WORDMARK_WIDTH)
