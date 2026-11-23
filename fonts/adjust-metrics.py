"""Enlarge Dongle to Outfit's x-height and give it balanced vertical metrics.
Shrinking unitsPerEm (outlines untouched) scales every glyph up by 1000/UPEM.
Ascent/descent are chosen so caps sit centred in the line box and accents/descenders fit."""
import sys
from fontTools.ttLib import TTFont
UPEM, ASC, DESC = 590, 575, 168   # 1.695x; ascent 0.975em, descent 0.285em
for p in sys.argv[1:]:
    f = TTFont(p)
    f['head'].unitsPerEm = UPEM
    h, o = f['hhea'], f['OS/2']
    h.ascent, h.descent, h.lineGap = ASC, -DESC, 0
    o.sTypoAscender, o.sTypoDescender, o.sTypoLineGap = ASC, -DESC, 0
    o.usWinAscent, o.usWinDescent = ASC, DESC
    o.fsSelection |= 1 << 7          # USE_TYPO_METRICS
    f.flavor = 'woff2'
    f.save(p)
