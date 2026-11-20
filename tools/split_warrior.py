"""Extract the warrior's original pixels. Requires Pillow; run from any directory."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source" / "warrior_sheet.png"
OUTPUT = ROOT / "public" / "assets" / "warrior"
ALPHA_CUTOFF = 12


def crop_part(sheet, box, seed=None):
    """Use the annotated rectangle first, then remove faint alpha residue and trim."""
    part = sheet.crop(box)
    alpha = part.getchannel("A").point(lambda value: value if value >= ALPHA_CUTOFF else 0)
    if seed is not None:
        # Only for rectangles crossed by another asset. Keep the selected silhouette.
        visible = alpha.point(lambda value: 255 if value else 0)
        point = (seed[0] - box[0], seed[1] - box[1])
        if visible.getpixel(point) != 255:
            raise ValueError(f"Selection seed {seed} must be on a visible pixel")
        ImageDraw.floodfill(visible, point, 127)
        keep = visible.point(lambda value: 255 if value == 127 else 0)
        alpha = Image.composite(alpha, Image.new("L", part.size), keep)
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError(f"No visible part in {box}")
    part.putalpha(alpha)
    return part.crop(bounds)


def join(upper, lower, left, top):
    """Place the cuff or boot over the previous part, using translation only."""
    x = -min(0, left)
    result = Image.new("RGBA", (
        max(x + upper.width, x + left + lower.width),
        max(upper.height, top + lower.height),
    ))
    result.alpha_composite(upper, (x, 0))
    result.alpha_composite(lower, (x + left, top))
    return result.crop(result.getchannel("A").getbbox())


def crop_reference(sheet):
    # The atlas divider crosses the blade. Keep its pixels only near the solid blade edge.
    region = sheet.crop((0, 0, 485, 710))
    alpha = region.getchannel("A")
    edge = alpha.crop((420, 0, 485, 710))
    blade = edge.point(lambda value: 255 if value >= 115 else 0).filter(ImageFilter.MaxFilter(5))
    alpha.paste(Image.composite(edge, Image.new("L", edge.size), blade), (420, 0))
    region.putalpha(alpha)
    return crop_part(region, (0, 23, 485, 710), (279, 440))


def main():
    with Image.open(SOURCE) as sheet:
        if sheet.mode != "RGBA" or sheet.size != (1536, 1024):
            raise ValueError(f"Unexpected source: {sheet.mode}, {sheet.size}")

        head = crop_part(sheet, (448, 32, 735, 320), (620, 220))
        body = crop_part(sheet, (460, 325, 870, 732), (715, 405))
        front_sleeve = crop_part(sheet, (866, 346, 988, 502))
        front_glove = crop_part(sheet, (869, 503, 974, 635))
        back_sleeve = crop_part(sheet, (1160, 345, 1294, 503), (1217, 398))
        back_glove = crop_part(sheet, (1207, 495, 1315, 629), (1264, 597))
        front_pants = crop_part(sheet, (601, 692, 736, 823), (673, 767))
        front_boot = crop_part(sheet, (571, 818, 706, 956), (633, 878))
        back_pants = crop_part(sheet, (802, 696, 923, 828))
        back_boot = crop_part(sheet, (788, 830, 926, 954))

        parts = {
            "head": head,
            "body": body,
            "arm_front": join(front_sleeve, front_glove, 1, 123),
            "arm_back": join(back_sleeve, back_glove, 28, 117),
            "leg_front": join(front_pants, front_boot, -12, 98),
            "leg_back": join(back_pants, back_boot, -8, 99),
            "sword": crop_part(sheet, (1316, 480, 1501, 838)),
            "shadow": crop_part(sheet, (1309, 899, 1502, 949)),
            "reference": crop_reference(sheet),
        }

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, part in parts.items():
        if part.mode != "RGBA" or part.getchannel("A").getextrema()[0] != 0:
            raise ValueError(f"{name} must have an RGBA background")
        part.save(OUTPUT / f"{name}.png", optimize=True)
        print(f"{name}.png: {part.width} x {part.height}")


if __name__ == "__main__":
    main()
