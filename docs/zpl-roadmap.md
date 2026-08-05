# ZPL Command Roadmap

What's supported, what's next, what's planned.

## Status legend

| Mark | Meaning |
|:-:|---|
| `[x]` | Supported: parsed on import, visible and editable in the UI, re-emitted on export. Two exemptions from the UI leg: structural commands (`^XA`, `^FS`, prefix changers) carry no user state, and control commands the app normalises (`^FW`/`^LR`/`^BY` into per-object properties, `^CI` into canonical UTF-8), where auto-management beats a manual field. Rows with a parenthesised caveat have a known sub-limitation (the import report flags it) but still count as supported |
| `[ ]` | Not yet supported; the **Bucket** column says when |

**Buckets** (for `[ ]` rows):

| Bucket | What it means |
|---|---|
| `Coming soon` | Modellable in the designer / settings UI with no printer connection; next registry / parser sweep |
| `Native build` | Needs a connected printer or printer-resident state (host queries, calibration, downloads to printer storage, RFID hardware). Some rows are one-way data commands and candidates for the passthrough lane rather than full modelling |
| `Out of scope` | Intentionally not modelled; every such row states its reason inline (device-specific hardware like `^JW` PAX ribbon tension, legacy transport, or a superseding command) |

Tracked scope: the ZPL II Programming Guide. Legacy-RFID-guide commands
(`^RA`, `^RE`, `^WF`, `^WV`) and `^WI` (duplicated by `^ND`) sit outside the
table; passthrough preserves them.
Convention: one row per command; prefix twins of the SAME command (e.g.
`^HL` / `~HL`) share a row unless their support status diverges (^PH/~PH,
^PP/~PP); distinct commands never share. The row total is
pinned in `scripts/gen-coverage.mjs`; adding or removing a row is a
deliberate act that must move the pin.

The Printer Settings Modal (Media & Feed / Print Quality / Clock & Time / Encoding & Language / Identity) is now shipped; commands that didn't make the first cut sit under `Coming soon` and slot into the existing tab UI without infrastructure work.

## Layout & flow

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^XA` | start label | |
| `[x]` | `^XZ` | end label | |
| `[x]` | `^PW` | print width | |
| `[x]` | `^LL` | label length | |
| `[x]` | `^LH` | label home origin | |
| `[x]` | `^LS` | label shift | |
| `[x]` | `^LT` | label top offset | |
| `[x]` | `^MM` | print mode (tear off / peel / cutter) | |
| `[x]` | `^MT` | media type | |
| `[x]` | `^PQ` | print quantity | |
| `[x]` | `^LR` | label reverse | |
| `[x]` | `^PO` | print orientation | |
| `[x]` | `^PM` | print mirror | |
| `[x]` | `^PR` | print rate | |
| `[x]` | `^MD` | media darkness | |
| `[x]` | `~SD` | set darkness | |

## Fields

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^FO` | field origin | |
| `[x]` | `^FT` | field top | |
| `[x]` | `^FD` | field data | |
| `[x]` | `^FS` | field separator | |
| `[x]` | `^FH` | field hex indicator | |
| `[x]` | `^FR` | field reverse | |
| `[x]` | `^FX` | field comment | |
| `[x]` | `^FW` | default field rotation | |
| `[x]` | `^FB` | multi line text block | |
| `[x]` | `^TB` | text block | |
| `[x]` | `^FN` | variable placeholder | |
| `[x]` | `^FV` | variable data | |
| `[x]` | `^FE` | field number embed character | |
| `[x]` | `^FC` | field clock (date / time) | |
| `[x]` | `^BY` | barcode field default | |
| `[ ]` | `^FM` | PDF417/MicroPDF417 structured-append origins (niche; ignored by all other commands) | `Out of scope` |
| `[x]` | `^FP` | vertical / reverse field layout (CJK / RTL) | |
| `[x]` | `^CO` | font cache size (scalable character cache) | |
| `[ ]` | `^CP` | kiosk remove label: eject / retract presented page (KR403 only) | `Out of scope` |
| `[x]` | `^CV` | code validation | |

## Text & fonts

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^A0` | scalable font 0 | |
| `[x]` | `^A` | fonts A to Z, 0 to 9 (best effort sizing) | |
| `[x]` | `^A@` | TrueType reference (face not imported; best-effort sizing) | |
| `[x]` | `^CF` | change default font | |
| `[x]` | `^CI` | international encoding | |
| `[x]` | `^CW` | font alias (printer resident) | |
| `[x]` | `^FL` | font linking | |
| `[ ]` | `^LF` | list font links | `Native build` |
| `[ ]` | `~DB` | download bitmap font (one-way payload; passthrough candidate) | `Native build` |
| `[ ]` | `~DS` | download scalable font (one-way payload; passthrough candidate) | `Native build` |
| `[ ]` | `~DT` | download TrueType font (one-way payload; passthrough candidate) | `Native build` |
| `[ ]` | `~DU` | download unbounded TrueType (one-way payload; passthrough candidate) | `Native build` |
| `[ ]` | `~DE` | download encoding (one-way payload; passthrough candidate) | `Native build` |
| `[ ]` | `~DN` | abort download | `Native build` |

## Barcodes

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^BC` | Code 128 | |
| `[x]` | `^B3` | Code 39 | |
| `[x]` | `^BA` | Code 93 | |
| `[x]` | `^B1` | Code 11 | |
| `[x]` | `^B2` | Interleaved 2 of 5 | |
| `[x]` | `^BI` | Industrial 2 of 5 | |
| `[x]` | `^BJ` | Standard 2 of 5 | |
| `[x]` | `^BK` | ANSI Codabar | |
| `[x]` | `^BL` | LOGMARS | |
| `[x]` | `^BM` | MSI | |
| `[x]` | `^BP` | Plessey | |
| `[x]` | `^BE` | EAN 13 | |
| `[x]` | `^B8` | EAN 8 | |
| `[x]` | `^BU` | UPC A | |
| `[x]` | `^B9` | UPC E | |
| `[x]` | `^BR` | GS1 Databar | |
| `[x]` | `^B5` | Planet Code | |
| `[x]` | `^BZ` | POSTNET / Intelligent Mail / Planet | |
| `[x]` | `^BS` | UPC / EAN 2 or 5 digit supplement | |
| `[x]` | `^B4` | Code 49 | |
| `[x]` | `^BQ` | QR Code | |
| `[x]` | `^BX` | DataMatrix | |
| `[x]` | `^B7` | PDF417 | |
| `[x]` | `^BF` | MicroPDF417 | |
| `[x]` | `^B0` / `^BO` | Aztec | |
| `[x]` | `^BB` | CODABLOCK F | |
| `[x]` | `^BD` | UPS MaxiCode | |
| `[x]` | `^BT` | TLC39 | |

## Graphics

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^GB` | graphic box (also lines) | |
| `[x]` | `^GD` | diagonal line | |
| `[x]` | `^GE` | ellipse | |
| `[x]` | `^GC` | circle | |
| `[x]` | `^GF` | monochrome bitmap (A hex/RLE, B64/Z64 wrappers, raw binary B; raw C preserved) | |
| `[x]` | `^GS` | graphic symbol (printer resident chars) | |
| `[ ]` | `^IL` | image load | `Native build` |
| `[ ]` | `^IM` | image move | `Native build` |
| `[ ]` | `^ID` | object delete: graphics, fonts, stored formats (wildcards) | `Native build` |
| `[ ]` | `^IS` | image save | `Native build` |
| `[ ]` | `~DG` | download graphic (one-way payload; passthrough candidate) | `Native build` |
| `[ ]` | `~EG` | erase download graphics | `Native build` |

## Serialisation

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^SN` | serial counter, own start value | |
| `[x]` | `^SF` | serial mask over ^FD data | |

## Templates & variables

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^DF` / `^DFR` | store template | |
| `[x]` | `^XF` / `^XFR` | recall template | |
| `[x]` | `^XG` | recall graphic | |
| `[x]` | `~DY` | download font / graphic | |

## Media & feed

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^MN` | media tracking (web / mark / continuous) | |
| `[x]` | `^ML` | maximum label length | |
| `[x]` | `^MF` | media feed | |
| `[x]` | `^XB` | suppress backfeed | |
| `[x]` | `^MA` | maintenance alert | |
| `[x]` | `^MC` | map clear (N retains the bitmap behind subsequent labels) | |
| `[x]` | `^MI` | maintenance info message | |
| `[x]` | `^MP` | mode protection (panel lockdown; E re-enables) | |
| `[x]` | `^MU` | units of measure | |
| `[x]` | `^MW` | head cold warning | |

## Print quality

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^JZ` | reprint after error | |
| `[x]` | `^JT` | head test interval | |
| `[x]` | `~TA` | tear off adjust | |
| `[x]` | `^PA` | advanced text properties | |
| `[x]` | `^JH` | early warning settings | |
| `[x]` | `~JS` | change backfeed sequence (A/B/N/O or percent 10-90) | |
| `[x]` | `^PF` | slew given number of dot rows | |
| `[x]` | `^PH` | slew home (feed one blank label) | |
| `[ ]` | `~PH` | slew home (control form; after current format or at pause) | `Native build` |
| `[x]` | `^PP` | programmable pause (in format) | |
| `[ ]` | `~PP` | pause (immediate) | `Native build` |
| `[ ]` | `~PR` | applicator reprint | `Native build` |
| `[ ]` | `~PS` | print start (resume from pause) | `Native build` |
| `[ ]` | `^CN` | cut now (KR403 kiosk cutter) | `Out of scope` |
| `[ ]` | `~PL` | present length addition (KR403 kiosk presenter) | `Out of scope` |
| `[ ]` | `^PN` | presenter cycle (KR403 kiosk only) | `Out of scope` |
| `[ ]` | `^JW` | set ribbon tension (PAX series only) | `Out of scope` |
| `[x]` | `^JU` | configuration update | |

## Clock & time

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^ST` | set date & time (static + live-clock mode) | |
| `[x]` | `^KD` | date & time format | |
| `[x]` | `^SO` | RTC offset (secondary / tertiary clock) | |

## Encoding & language

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^KL` | define language | |
| `[x]` | `^SE` | encoding table | |
| `[x]` | `^SZ` | set ZPL mode | |

## Identity & access

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^KN` | printer name + description | |
| `[x]` | `^SL` | clock mode (S / T / TOL) + language | |
| `[x]` | `^KP` | set password | |

## Configuration & persistence

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[x]` | `^CC` / `~CC` | change caret | |
| `[x]` | `^CD` / `~CD` | change delimiter | |
| `[x]` | `^CT` / `~CT` | change tilde | |
| `[ ]` | `^CM` | change memory letter assignment | `Native build` |
| `[ ]` | `~KB` | kill battery | `Native build` |

## Hardware control & calibration

These need printer-side feedback or are intrinsically connection bound.

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[ ]` | `~JA` | cancel all | `Native build` |
| `[ ]` | `^JB` | initialize flash memory | `Native build` |
| `[ ]` | `~JB` | reset optional memory (battery models) | `Native build` |
| `[ ]` | `~JC` | media sensor calibration | `Native build` |
| `[ ]` | `~JD` | enable communications diagnostics | `Native build` |
| `[ ]` | `~JE` | disable communications diagnostics | `Native build` |
| `[ ]` | `~JF` | set battery condition (PA/PT400 battery printers) | `Out of scope` |
| `[ ]` | `~JG` | graphing sensor calibration | `Native build` |
| `[ ]` | `^JI` / `~JI` | start ZBI | `Native build` |
| `[ ]` | `^JJ` | set auxiliary port | `Native build` |
| `[ ]` | `^JS` | sensor select (reflective / transmissive) | `Native build` |
| `[ ]` | `~JL` | set label length | `Native build` |
| `[x]` | `^JM` | set dots per millimeter (B halves density and doubles format scale; A = normal, default) | |
| `[ ]` | `~JN` | head test fatal | `Native build` |
| `[ ]` | `~JO` | head test non-fatal | `Native build` |
| `[ ]` | `~JP` | pause and cancel format | `Native build` |
| `[ ]` | `~JQ` | terminate ZBI | `Native build` |
| `[ ]` | `~JR` | power on reset | `Native build` |
| `[ ]` | `~JX` | cancel partial format | `Native build` |
| `[ ]` | `~RO` | reset advanced counter | `Native build` |
| `[ ]` | `^SC` | set serial comm | `Native build` |
| `[ ]` | `^SI` | set sensor intensity | `Native build` |
| `[ ]` | `^SP` | start print at dot row (throughput hint, no visual effect) | `Out of scope` |
| `[ ]` | `^SQ` | halt ZebraNet alert (companion to ^SX) | `Native build` |
| `[ ]` | `^SR` | set printhead resistance | `Native build` |
| `[ ]` | `^SS` | set media sensors | `Native build` |
| `[ ]` | `^SX` | set ZebraNet alert | `Native build` |
| `[ ]` | `^TO` | transfer object | `Native build` |
| `[ ]` | `~WC` | print configuration label | `Native build` |
| `[ ]` | `^WD` | print directory label | `Native build` |
| `[ ]` | `~WQ` | write query | `Native build` |
| `[ ]` | `^WT` | legacy RFID write; superseded by ^RF | `Out of scope` |
| `[ ]` | `^KV` | kiosk values: cutter / presenter config (KR403 only) | `Out of scope` |
| `[ ]` | `^XS` | set dynamic media calibration | `Native build` |
| `[ ]` | `~PM` | decommissioning mode | `Native build` |
| `[ ]` | `^ZZ` | printer sleep (PA/PT400 only) | `Out of scope` |

## Host communication

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[ ]` | `~HB` | battery status (mobile printers) | `Out of scope` |
| `[ ]` | `~HD` | head diagnostic | `Native build` |
| `[ ]` | `^HF` | host format | `Native build` |
| `[ ]` | `^HG` | host graphic | `Native build` |
| `[ ]` | `^HH` | configuration label return | `Native build` |
| `[ ]` | `~HI` | host identification | `Native build` |
| `[ ]` | `~HM` | host RAM status | `Native build` |
| `[ ]` | `~HQ` | host query | `Native build` |
| `[ ]` | `~HS` | host status return | `Native build` |
| `[ ]` | `^HT` | host linked fonts list | `Native build` |
| `[ ]` | `~HU` | ZebraNet alert config | `Native build` |
| `[ ]` | `^HV` | host verification | `Native build` |
| `[ ]` | `^HW` | host directory | `Native build` |
| `[ ]` | `^HY` | upload graphics | `Native build` |
| `[ ]` | `^HZ` | display description info | `Native build` |

## RFID

Needs an R-series printer, which no test device covers; modelled rows are
spec-only. Stage A: ^RS/^RB/^RW settings. Stage B: ^RF write element plus its
password-coupled ^RL. Read-back stays native. ^RM/^RR folded into ^RS,
^RN/~RV dropped from the current guide; all four passthrough only.

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[ ]` | `^RF` | read / write RFID (write path plannable; read-back stays native) | `Coming soon` |
| `[ ]` | `^RI` | get tag ID | `Native build` |
| `[ ]` | `^RM` | enable motion (pre-Link-OS; folded into ^RS; passthrough) | `Out of scope` |
| `[ ]` | `^RN` | detect multiple tags (pre-Link-OS; absent from current guide; passthrough) | `Out of scope` |
| `[ ]` | `^RR` | RFID retries (pre-Link-OS; folded into ^RS; passthrough) | `Out of scope` |
| `[ ]` | `^RB` | define EPC data structure (partitions consumed by ^RF EPC writes) | `Coming soon` |
| `[ ]` | `^RS` | RFID setup (tag type, programming position, retries, error handling) | `Coming soon` |
| `[ ]` | `^RT` | read tag (legacy; superseded by ^RF read) | `Native build` |
| `[ ]` | `^RU` | read unique chip serialization (TID-derived EPC serial) | `Native build` |
| `[ ]` | `~RV` | report encoding result (pre-Link-OS; absent from current guide; passthrough) | `Out of scope` |
| `[ ]` | `^RW` | set read & write power | `Coming soon` |
| `[ ]` | `^RL` | lock / permalock tag memory (password-coupled companion of ^RF) | `Coming soon` |
| `[ ]` | `^HR` | calibrate RFID tag position | `Native build` |
| `[ ]` | `^HL` / `~HL` | RFID data log (return to host) | `Native build` |

## Network

| Status | Command | Description | Bucket |
|:-:|---|---|---|
| `[ ]` | `^NB` | check for wired print server at boot | `Native build` |
| `[ ]` | `^NC` | select wired / wireless primary device | `Native build` |
| `[ ]` | `~NC` | network connect (legacy RS-485 multidrop addressing) | `Out of scope` |
| `[ ]` | `^NI` | network ID (legacy RS-485 multidrop addressing) | `Out of scope` |
| `[ ]` | `^NN` | set SNMP | `Native build` |
| `[ ]` | `^NP` | boot settings source: printer vs print server | `Native build` |
| `[ ]` | `~NR` | set all transparent (legacy RS-485 multidrop addressing) | `Out of scope` |
| `[ ]` | `^NT` | set SMTP | `Native build` |
| `[ ]` | `~NT` | set connected printer transparent (legacy RS-485 multidrop addressing) | `Out of scope` |
| `[ ]` | `^NW` | web auth timeout | `Native build` |
| `[ ]` | `^KC` | set client identifier (DHCP option 61) | `Native build` |
| `[ ]` | `^ND` | change network settings | `Native build` |
| `[ ]` | `^NS` | change wired network settings | `Native build` |
| `[ ]` | `^WA` | set antenna parameters | `Native build` |
| `[ ]` | `^WE` | set WEP mode (obsolete wireless security; use ^WX) | `Out of scope` |
| `[ ]` | `^WL` | set LEAP (obsolete wireless security; use ^WX) | `Out of scope` |
| `[ ]` | `^WP` | set wireless password | `Native build` |
| `[ ]` | `^WR` | set transmit rate | `Native build` |
| `[ ]` | `^WS` | set wireless radio card values | `Native build` |
| `[ ]` | `^WX` | configure wireless security | `Native build` |
| `[ ]` | `~WL` | print network configuration label | `Native build` |
| `[ ]` | `~WR` | reset wireless radio card | `Native build` |
