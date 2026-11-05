"""
Genera los iconos de la APK a partir de los de la web (frontend/public/icons),
uno por cada acento predefinido, con el mismo hue-rotate que aplica la web al
logo y al favicon (themeStore.ts). Volver a ejecutarlo si cambia el logo:

    python android/tools/generate_icons.py
"""
import colorsys
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
WEB_ICONS = ROOT / "frontend" / "public" / "icons"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Mismos acentos que ACCENT_COLORS en frontend/src/store/themeStore.ts
ACCENTS = {
    "green": "#1DB954",
    "cyan": "#00F2FE",
    "magenta": "#F107A3",
    "purple": "#8A2BE2",
    "amber": "#FF9F1C",
    "crimson": "#FF0054",
    "gold": "#FFD700",
}
BASE_GREEN_HUE = 141.2  # tono del logo original (themeStore.ts)
BG = (9, 9, 11, 255)    # @color/bg_dark

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def hex_hue(hex_color: str) -> int:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, _, _ = colorsys.rgb_to_hls(r, g, b)
    return round(h * 360)


def hue_rotate(img: Image.Image, degrees: float) -> Image.Image:
    """El filtro CSS hue-rotate() (matriz de la especificación), en sRGB como el navegador."""
    if degrees <= 4 or degrees >= 356:
        return img.copy()
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    m = np.array([
        [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
    ])
    arr = np.asarray(img.convert("RGBA")).astype(np.float64)
    rgb = np.clip(arr[..., :3] @ m.T, 0, 255)
    return Image.fromarray(np.dstack([rgb, arr[..., 3]]).astype(np.uint8), "RGBA")


def fit(logo: Image.Image, canvas_px: int, logo_ratio: float) -> Image.Image:
    """Centra el logo (recortado a su contenido) ocupando logo_ratio del lado más largo."""
    logo = logo.crop(logo.getchannel("A").getbbox())
    scale = canvas_px * logo_ratio / max(logo.size)
    logo = logo.resize((max(1, round(logo.width * scale)), max(1, round(logo.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_px, canvas_px), (0, 0, 0, 0))
    canvas.alpha_composite(logo, ((canvas_px - logo.width) // 2, (canvas_px - logo.height) // 2))
    return canvas


def white_silhouette(img: Image.Image) -> Image.Image:
    alpha = img.getchannel("A")
    white = Image.new("RGBA", img.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    return white


def main():
    logo = Image.open(WEB_ICONS / "icon-512.png").convert("RGBA")
    mono = white_silhouette(Image.open(WEB_ICONS / "icon-monochrome-512.png").convert("RGBA"))

    # La capa adaptativa mide 108dp y se ven ~72dp: el logo ocupa ~50 dp, como
    # en el acceso directo de la web (dentro de la zona segura de 66 dp).
    LAYER_RATIO = 0.46
    for density, factor in DENSITIES.items():
        mipmap = RES / f"mipmap-{density}"
        mipmap.mkdir(parents=True, exist_ok=True)
        layer_px = round(108 * factor)
        legacy_px = round(48 * factor)

        fit(mono, layer_px, LAYER_RATIO).save(mipmap / "ic_launcher_mono.png", optimize=True)

        for key, hex_color in ACCENTS.items():
            diff = round((hex_hue(hex_color) - BASE_GREEN_HUE + 360) % 360)
            tinted = hue_rotate(logo, diff)
            fit(tinted, layer_px, LAYER_RATIO).save(mipmap / f"ic_launcher_fg_{key}.png", optimize=True)

            # Android 7.x (sin iconos adaptativos): cuadrado redondeado oscuro con el logo
            legacy = Image.new("RGBA", (legacy_px, legacy_px), (0, 0, 0, 0))
            ImageDraw.Draw(legacy).rounded_rectangle(
                [0, 0, legacy_px - 1, legacy_px - 1], radius=round(legacy_px * 0.22), fill=BG)
            legacy.alpha_composite(fit(tinted, legacy_px, 0.6))
            legacy.save(mipmap / f"ic_launcher_{key}.png", optimize=True)

        # Icono de la barra de estado (notificación): silueta blanca de 24 dp
        drawable = RES / f"drawable-{density}"
        drawable.mkdir(parents=True, exist_ok=True)
        fit(mono, round(24 * factor), 0.85).save(drawable / "ic_stat_koko.png", optimize=True)

    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    for key in ACCENTS:
        (anydpi / f"ic_launcher_{key}.xml").write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- Generado por android/tools/generate_icons.py -->\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/bg_dark" />\n'
            f'    <foreground android:drawable="@mipmap/ic_launcher_fg_{key}" />\n'
            '    <monochrome android:drawable="@mipmap/ic_launcher_mono" />\n'
            '</adaptive-icon>\n',
            encoding="utf-8",
        )
    print("Iconos generados en", RES)


if __name__ == "__main__":
    main()
