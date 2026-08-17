# PrintLab ZPL Bold

PrintLab ZPL Bold is a derivative work of Roboto Condensed by
Christian Robertson, distributed by Google Fonts under the Apache
License, Version 2.0.

## Modifications

Relative to upstream Roboto Condensed:

- Built from the `wght=900` instance of the variable font.
- Per-glyph horizontal advance widths (`hmtx`) and outlines scaled
  individually to match the metrics of Zebra firmware's CG Triumvirate
  Condensed Bold, so layout positions agree with ZPL `^A0` rendering.
- Vertical outlines scaled to align cap heights with the same target.
- TrueType hinting tables (`prep`, `fpgm`, `cvt`) removed so the
  modified outlines render unhinted.
- GPOS (kerning, capital spacing) dropped and the GSUB `liga` feature
  removed: Zebra's firmware lays out Font 0 with fixed per-glyph
  advances, no kerning and no ligatures.
- All outlines shifted down ~0.04 em to match CG Triumvirate's rendered
  vertical placement.
- Ink spans, advances and accent anchors of individual glyphs across the
  printable Latin-1 range remapped to CG Triumvirate's measured metrics.
- Family and PostScript names renamed from "Roboto Condensed" to
  "PrintLab ZPL".

## License

Apache License, Version 2.0. Full text in `LICENSE-APACHE-2.0.txt`
next to this file, or at https://www.apache.org/licenses/LICENSE-2.0

Upstream source:
https://github.com/google/fonts/tree/main/ofl/robotocondensed
