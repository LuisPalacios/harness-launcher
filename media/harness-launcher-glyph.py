# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.60.1"]
# ///
"""Builds media/harness-launcher-glyph.woff, the status bar icon font.

The status bar can only draw single-color font glyphs, so this turns the
rocket of harness-launcher-toolbar.svg into one silhouette: body, fins,
nozzle and flame filled, the window cut out. VS Code colors it like any
other status bar icon. Run it after changing the toolbar SVG:

    uv run media/harness-launcher-glyph.py
"""

import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

HERE = Path(__file__).parent
SOURCE = HERE / "harness-launcher-toolbar.svg"
TARGET = HERE / "harness-launcher-glyph.woff"
GLYPH = "rocket"
CODEPOINT = 0xE000  # private use area; package.json refers to it as "\\E000"
EM = 1000
FILLED = {"flame", "fin", "nozzle", "body"}  # "core" and "shade" sit inside these
HOLES = {"ring"}  # the window becomes a cut-out
NS = {"svg": "http://www.w3.org/2000/svg"}


def matrix(transform: str) -> tuple[float, ...]:
    """Composes an SVG transform list of translate/rotate/scale into an affine matrix."""
    m = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    for name, args in re.findall(r"(\w+)\(([^)]*)\)", transform):
        v = [float(a) for a in args.replace(",", " ").split()]
        if name == "translate":
            step = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale":
            step = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif name == "rotate":
            c, s = math.cos(math.radians(v[0])), math.sin(math.radians(v[0]))
            step = (c, s, -s, c, 0, 0)
        else:
            raise SystemExit(f"unsupported transform {name}")
        a, b, cc, d, e, f = m
        a2, b2, c2, d2, e2, f2 = step
        m = (a * a2 + cc * b2, b * a2 + d * b2, a * c2 + cc * d2, b * c2 + d * d2, a * e2 + cc * f2 + e, b * e2 + d * f2 + f)
    return m


def circle_path(cx: float, cy: float, r: float) -> str:
    k = 0.5523 * r
    return (
        f"M{cx + r} {cy} C{cx + r} {cy + k} {cx + k} {cy + r} {cx} {cy + r} "
        f"C{cx - k} {cy + r} {cx - r} {cy + k} {cx - r} {cy} "
        f"C{cx - r} {cy - k} {cx - k} {cy - r} {cx} {cy - r} "
        f"C{cx + k} {cy - r} {cx + r} {cy - k} {cx + r} {cy} Z"
    )


def main() -> None:
    root = ET.parse(SOURCE).getroot()
    x0, y0, w, h = (float(n) for n in root.get("viewBox", "").split())
    group = root.find("svg:g", NS)
    if group is None:
        raise SystemExit(f"{SOURCE.name}: expected one <g> with the rocket")
    a, b, c, d, e, f = matrix(group.get("transform", ""))
    # SVG space -> font units: viewBox onto the em square, y pointing up.
    sx, sy = EM / w, -EM / h
    to_font = (a * sx, b * sy, c * sx, d * sy, (e - x0) * sx, (f - y0) * sy + EM)

    shapes: list[tuple[str, str]] = []
    for el in group:
        cls = el.get("class", "")
        tag = el.tag.split("}")[-1]
        if cls not in FILLED | HOLES:
            continue
        if tag == "path":
            shapes.append((cls, el.get("d", "")))
        elif tag == "circle":
            shapes.append((cls, circle_path(float(el.get("cx", 0)), float(el.get("cy", 0)), float(el.get("r", 0)))))
    if not shapes:
        raise SystemExit(f"{SOURCE.name}: no rocket shapes found")

    glyph_pen = TTGlyphPen(None)
    quad = Cu2QuPen(glyph_pen, max_err=1.0, reverse_direction=False)
    for cls, d_attr in shapes:
        rec = RecordingPen()
        parse_path(d_attr, TransformPen(rec, to_font))
        area = AreaPen()
        rec.replay(area)
        # TrueType fills clockwise contours (negative area); holes run the other way.
        want_clockwise = cls in FILLED
        if (area.value < 0) != want_clockwise:
            rec.replay(ReverseContourPen(quad))
        else:
            rec.replay(quad)
    rocket = glyph_pen.glyph()

    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder([".notdef", GLYPH])
    fb.setupCharacterMap({CODEPOINT: GLYPH})
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), GLYPH: rocket})
    fb.setupHorizontalMetrics({".notdef": (EM, 0), GLYPH: (EM, 0)})
    fb.setupHorizontalHeader(ascent=EM, descent=0)
    fb.setupNameTable({"familyName": "Harness Launcher Glyph", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=EM, sTypoDescender=0, usWinAscent=EM, usWinDescent=0)
    fb.setupPost()
    fb.font.flavor = "woff"
    fb.save(TARGET)
    print(f"wrote {TARGET.name}: U+{CODEPOINT:04X} from {len(shapes)} shapes of {SOURCE.name}")


if __name__ == "__main__":
    main()
