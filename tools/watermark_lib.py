"""Водяной знак: сетка вокруг товара + логотип в углу упаковки."""
from __future__ import annotations

from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
except ImportError:
    Image = None

DIAGONAL_TEXT = 'Мороженое Избербаш '
JPEG_QUALITY = 85
DEFAULT_LOGO = Path(__file__).resolve().parents[1] / 'Demo' / 'watermark.png'


def load_font(size: int):
    candidates = [
        'C:/Windows/Fonts/arial.ttf',
        'C:/Windows/Fonts/segoeui.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1]


def build_safe_background_mask(img: Image.Image, bg_threshold: int = 235) -> Image.Image:
    gray = img.convert('L')
    w, h = img.size

    product = gray.point(lambda p: 255 if p < bg_threshold else 0)
    kernel = min(51, max(17, int(min(w, h) * 0.05)))
    if kernel % 2 == 0:
        kernel += 1
    protected = product.filter(ImageFilter.MaxFilter(kernel))

    bg = gray.point(lambda p: 255 if p >= bg_threshold else 0)
    not_protected = Image.eval(protected, lambda p: 255 - p)
    return ImageChops.multiply(bg, not_protected)


def build_diagonal_layer(size: tuple[int, int]) -> Image.Image:
    overlay = Image.new('RGBA', size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font_size = max(14, int(min(size) * 0.05))
    font = load_font(font_size)
    tw, th = text_size(draw, DIAGONAL_TEXT, font)
    step_x = max(tw + 40, int(size[0] * 0.28))
    step_y = max(th + 50, int(size[1] * 0.18))
    fill = (120, 120, 120, 38)

    for row, y in enumerate(range(-size[1], size[1] * 2, step_y)):
        offset = (step_x // 2) if row % 2 else 0
        for x in range(-size[0], size[0] * 2, step_x):
            draw.text((x + offset, y), DIAGONAL_TEXT, font=font, fill=fill)

    rotated = overlay.rotate(28, expand=False, resample=Image.Resampling.BICUBIC)
    if rotated.size != size:
        rotated = rotated.crop((0, 0, size[0], size[1]))
    return rotated


def get_product_bbox(img: Image.Image, bg_threshold: int = 235) -> tuple[int, int, int, int] | None:
    gray = img.convert('L')
    product = gray.point(lambda p: 255 if p < bg_threshold else 0)
    return product.getbbox()


def prepare_logo_image(logo: Image.Image, bg_threshold: int = 42) -> Image.Image:
    logo = logo.convert('RGBA')
    pixels = logo.load()
    for y in range(logo.height):
        for x in range(logo.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            if r <= bg_threshold and g <= bg_threshold and b <= bg_threshold:
                pixels[x, y] = (r, g, b, 0)
                continue
            lum = (r + g + b) / 3
            tone = max(20, min(70, int(90 - lum * 0.35)))
            pixels[x, y] = (tone, tone, tone, min(255, a))
    return logo


def load_logo_image(logo_path: Path | str = DEFAULT_LOGO) -> Image.Image:
    with Image.open(logo_path) as logo:
        logo.load()
        return prepare_logo_image(logo)


def paste_logo_corner(
    layer: Image.Image,
    logo: Image.Image,
    corner: str = 'bottom-left',
    width_ratio: float = 0.42,
    opacity: float = 1.0,
) -> None:
    left, top, right, bottom = 0, 0, layer.width, layer.height
    corner_w = max(80, int(min(layer.width, layer.height) * width_ratio))
    margin_x = 0
    margin_y = max(4, int(min(layer.width, layer.height) * 0.006))

    ratio = corner_w / max(logo.width, 1)
    corner_h = max(1, int(logo.height * ratio))
    mark = logo.resize((corner_w, corner_h), Image.Resampling.LANCZOS)
    alpha = mark.getchannel('A').point(lambda p: int(p * opacity))
    mark.putalpha(alpha)

    if corner.endswith('right'):
        x = right - corner_w - margin_x
    else:
        x = left - int(corner_w * 0.14)
    if corner.startswith('top'):
        y = top + margin_y
    else:
        y = bottom - corner_h - margin_y

    x = min(x, layer.width - corner_w)
    y = max(0, min(y, layer.height - corner_h))
    layer.paste(mark, (x, y), mark)


def apply_product_watermark(img: Image.Image, logo: Image.Image | None = None) -> Image.Image:
    """Сетка на фоне + логотип в углу упаковки, без URL."""
    if logo is None:
        logo = load_logo_image()

    base = img.convert('RGBA')
    safe_mask = build_safe_background_mask(img.convert('RGB'))

    diagonal = build_diagonal_layer(base.size)
    diagonal_alpha = ImageChops.multiply(diagonal.getchannel('A'), safe_mask)
    diagonal.putalpha(diagonal_alpha)
    result = Image.alpha_composite(base, diagonal)

    overlay = Image.new('RGBA', base.size, (0, 0, 0, 0))
    paste_logo_corner(overlay, logo, corner='bottom-left')
    result = Image.alpha_composite(result, overlay)
    return result.convert('RGB')


def save_watermarked_image(img: Image.Image, path: Path) -> None:
    ext = path.suffix.lower()
    if ext in ('.jpg', '.jpeg'):
        img.save(path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
    elif ext == '.png':
        img.save(path, 'PNG', optimize=True)
    else:
        img.save(path)
