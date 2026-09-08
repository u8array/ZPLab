# ZPL Command Coverage

Every command of the ZPL II Programming Guide and what it takes to use it in ZPLab.

| Column | Meaning |
|---|---|
| **Web** | The browser build reads the command on import and writes it back on export: as itself, folded into object properties (`^FW`, `^LR`, `^BY`, `^MU`, `^LH`, `^LT`, `^CI`), or into the Setup Script (printer setup commands). Structural commands (`^XA`, `^FS`, prefix changers) carry no user state |
| **Desktop** | The same in the desktop app, which also talks to a connected printer; commands that need one (host queries, calibration, downloads to printer storage, RFID hardware) can only ever get a mark here |
| **Lint** | The source editor validates the command's parameters, not just its balance |

| Mark | Meaning |
|:-:|---|
| `[x]` | yes |
| `[~]` | planned |
| `[ ]` | no; a row with no mark at all is out of scope, and its name says why |

Tracked scope: the ZPL II Programming Guide. Commands the current guide dropped
but printers still accept (`^RN`, `~RV`, `^WT`) stay in the table; `^RA`, `^RE`,
`^RQ`, `^RZ`, `^WF`, `^WV` and `^WI` (duplicated by `^ND`) sit outside it, and
passthrough preserves them.
Convention: one row per command; prefix twins of the SAME command (e.g.
`^HL` / `~HL`) share a row unless their support diverges (^PH/~PH, ^PP/~PP);
distinct commands that merely share letters (e.g. ^JS/~JS, ^PM/~PM, ^NC/~NC)
never share. The row total is pinned in `packages/core/src/catalog/catalog.test.ts`.

<!-- coverage:start (generated from packages/core/src/catalog/commands.json by scripts/gen-coverage.mjs; run `pnpm coverage:gen`) -->
## Layout & flow

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^XA` | start label | `[x]` | `[x]` | `[ ]` |
| `^XZ` | end label | `[x]` | `[x]` | `[ ]` |
| `^PW` | print width | `[x]` | `[x]` | `[ ]` |
| `^LL` | label length | `[x]` | `[x]` | `[ ]` |
| `^LH` | label home origin | `[x]` | `[x]` | `[ ]` |
| `^LS` | label shift | `[x]` | `[x]` | `[ ]` |
| `^LT` | label top offset | `[x]` | `[x]` | `[ ]` |
| `^MU` | units of measure | `[x]` | `[x]` | `[ ]` |
| `^MM` | print mode | `[x]` | `[x]` | `[ ]` |
| `^MT` | media type | `[x]` | `[x]` | `[ ]` |
| `^PQ` | print quantity | `[x]` | `[x]` | `[ ]` |
| `^LR` | label reverse | `[x]` | `[x]` | `[ ]` |
| `^PO` | print orientation | `[x]` | `[x]` | `[ ]` |
| `^PM` | print mirror | `[x]` | `[x]` | `[ ]` |
| `^PR` | print rate | `[x]` | `[x]` | `[ ]` |

## Fields

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^FO` | field origin | `[x]` | `[x]` | `[ ]` |
| `^FT` | field top | `[x]` | `[x]` | `[ ]` |
| `^FD` | field data | `[x]` | `[x]` | `[ ]` |
| `^FS` | field separator | `[x]` | `[x]` | `[ ]` |
| `^FH` | field hex indicator | `[x]` | `[x]` | `[ ]` |
| `^FR` | field reverse | `[x]` | `[x]` | `[ ]` |
| `^FX` | field comment | `[x]` | `[x]` | `[ ]` |
| `^FW` | default field rotation | `[x]` | `[x]` | `[ ]` |
| `^FB` | multi line text block | `[x]` | `[x]` | `[ ]` |
| `^TB` | text block | `[x]` | `[x]` | `[ ]` |
| `^FN` | variable placeholder | `[x]` | `[x]` | `[ ]` |
| `^FV` | variable data | `[x]` | `[x]` | `[ ]` |
| `^FE` | field number embed character | `[x]` | `[x]` | `[ ]` |
| `^FC` | field clock | `[x]` | `[x]` | `[ ]` |
| `^BY` | barcode field default | `[x]` | `[x]` | `[ ]` |
| `^FM` | PDF417 structured-append origins, ignored elsewhere | `[ ]` | `[ ]` | `[ ]` |
| `^FP` | vertical / reverse field layout | `[x]` | `[x]` | `[ ]` |

## Text & fonts

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^A0` | scalable font 0 | `[x]` | `[x]` | `[ ]` |
| `^A` | fonts A to Z and 0 to 9 | `[x]` | `[x]` | `[ ]` |
| `^A@` | TrueType reference | `[x]` | `[x]` | `[ ]` |
| `^CF` | change default font | `[x]` | `[x]` | `[ ]` |
| `^CI` | international encoding | `[x]` | `[x]` | `[ ]` |
| `^PA` | advanced text properties | `[x]` | `[x]` | `[ ]` |
| `^CW` | font alias | `[x]` | `[x]` | `[ ]` |
| `^CO` | font cache size | `[x]` | `[x]` | `[ ]` |
| `^FL` | font linking | `[x]` | `[x]` | `[ ]` |
| `^LF` | list font links | `[ ]` | `[~]` | `[ ]` |
| `~DB` | download bitmap font | `[ ]` | `[~]` | `[ ]` |
| `~DS` | download scalable font | `[ ]` | `[~]` | `[ ]` |
| `~DT` | download TrueType font | `[ ]` | `[~]` | `[ ]` |
| `~DU` | download unbounded TrueType | `[ ]` | `[~]` | `[ ]` |
| `~DE` | download encoding | `[ ]` | `[~]` | `[ ]` |

## Barcodes

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^BC` | Code 128 | `[x]` | `[x]` | `[ ]` |
| `^B3` | Code 39 | `[x]` | `[x]` | `[ ]` |
| `^BA` | Code 93 | `[x]` | `[x]` | `[ ]` |
| `^B1` | Code 11 | `[x]` | `[x]` | `[ ]` |
| `^B2` | Interleaved 2 of 5 | `[x]` | `[x]` | `[ ]` |
| `^BI` | Industrial 2 of 5 | `[x]` | `[x]` | `[ ]` |
| `^BJ` | Standard 2 of 5 | `[x]` | `[x]` | `[ ]` |
| `^BK` | ANSI Codabar | `[x]` | `[x]` | `[ ]` |
| `^BL` | LOGMARS | `[x]` | `[x]` | `[ ]` |
| `^BM` | MSI | `[x]` | `[x]` | `[ ]` |
| `^BP` | Plessey | `[x]` | `[x]` | `[ ]` |
| `^BE` | EAN-13 | `[x]` | `[x]` | `[ ]` |
| `^B8` | EAN-8 | `[x]` | `[x]` | `[ ]` |
| `^BU` | UPC-A | `[x]` | `[x]` | `[ ]` |
| `^B9` | UPC-E | `[x]` | `[x]` | `[ ]` |
| `^BR` | GS1 DataBar | `[x]` | `[x]` | `[ ]` |
| `^B5` | Planet Code | `[x]` | `[x]` | `[ ]` |
| `^BZ` | POSTNET / Planet Code / Intelligent Mail | `[x]` | `[x]` | `[ ]` |
| `^BS` | UPC/EAN 2 or 5 digit add-on | `[x]` | `[x]` | `[ ]` |
| `^B4` | Code 49 | `[x]` | `[x]` | `[ ]` |
| `^BQ` | QR Code | `[x]` | `[x]` | `[ ]` |
| `^BX` | Data Matrix | `[x]` | `[x]` | `[ ]` |
| `^B7` | PDF417 | `[x]` | `[x]` | `[ ]` |
| `^BF` | MicroPDF417 | `[x]` | `[x]` | `[ ]` |
| `^B0` / `^BO` | Aztec | `[x]` | `[x]` | `[ ]` |
| `^BB` | CODABLOCK F | `[x]` | `[x]` | `[ ]` |
| `^BD` | UPS MaxiCode | `[x]` | `[x]` | `[ ]` |
| `^BT` | TLC39 | `[x]` | `[x]` | `[ ]` |
| `^CV` | code validation | `[x]` | `[x]` | `[ ]` |

## Graphics

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^GB` | graphic box | `[x]` | `[x]` | `[ ]` |
| `^GD` | diagonal line | `[x]` | `[x]` | `[ ]` |
| `^GE` | ellipse | `[x]` | `[x]` | `[ ]` |
| `^GC` | circle | `[x]` | `[x]` | `[ ]` |
| `^GF` | monochrome bitmap | `[x]` | `[x]` | `[ ]` |
| `^GS` | graphic symbol | `[x]` | `[x]` | `[ ]` |
| `^IL` | image load | `[ ]` | `[~]` | `[ ]` |
| `^IM` | image move | `[ ]` | `[~]` | `[ ]` |
| `^ID` | delete stored graphics, fonts and formats | `[ ]` | `[~]` | `[ ]` |
| `^IS` | image save | `[ ]` | `[x]` | `[ ]` |
| `~DG` | download graphic | `[ ]` | `[~]` | `[ ]` |
| `~DN` | abort download | `[ ]` | `[~]` | `[ ]` |
| `~DY` | download font / graphic | `[x]` | `[x]` | `[ ]` |
| `~EG` | erase download graphics | `[ ]` | `[~]` | `[ ]` |

## Serialisation

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^SN` | serial counter with its own start value | `[x]` | `[x]` | `[ ]` |
| `^SF` | serial mask over ^FD data | `[x]` | `[x]` | `[ ]` |

## Templates & variables

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^DF` | store template | `[~]` | `[~]` | `[ ]` |
| `^XF` | recall template | `[~]` | `[~]` | `[ ]` |
| `^XG` | recall graphic | `[x]` | `[x]` | `[ ]` |

## Media & feed

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^MN` | media tracking | `[x]` | `[x]` | `[ ]` |
| `^ML` | maximum label length | `[x]` | `[x]` | `[ ]` |
| `^MF` | media feed | `[x]` | `[x]` | `[ ]` |
| `^XB` | suppress backfeed | `[x]` | `[x]` | `[ ]` |
| `^MA` | maintenance alert | `[x]` | `[x]` | `[ ]` |
| `^MC` | map clear | `[x]` | `[x]` | `[ ]` |
| `^MI` | maintenance information message | `[x]` | `[x]` | `[ ]` |
| `^MP` | mode protection | `[x]` | `[x]` | `[ ]` |
| `^MW` | printhead cold warning | `[x]` | `[x]` | `[ ]` |

## Print quality

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^MD` | media darkness | `[x]` | `[x]` | `[ ]` |
| `~SD` | set darkness | `[x]` | `[x]` | `[ ]` |
| `^JZ` | reprint after error | `[x]` | `[x]` | `[ ]` |
| `^JT` | printhead test interval | `[x]` | `[x]` | `[ ]` |
| `~TA` | tear off adjust | `[x]` | `[x]` | `[ ]` |
| `^JH` | early warning settings | `[x]` | `[x]` | `[ ]` |
| `~JS` | change backfeed sequence | `[x]` | `[x]` | `[ ]` |
| `^PF` | slew given number of dot rows | `[x]` | `[x]` | `[ ]` |
| `^PH` | slew home | `[x]` | `[x]` | `[ ]` |
| `~PH` | slew home, immediate | `[ ]` | `[~]` | `[ ]` |
| `^PP` | programmable pause | `[x]` | `[x]` | `[ ]` |
| `~PP` | pause, immediate | `[ ]` | `[~]` | `[ ]` |
| `~PR` | applicator reprint | `[ ]` | `[~]` | `[ ]` |
| `~PS` | print start | `[ ]` | `[~]` | `[ ]` |
| `^CN` | cut now, KR403 kiosk only | `[ ]` | `[ ]` | `[ ]` |
| `~PL` | present length addition, KR403 kiosk only | `[ ]` | `[ ]` | `[ ]` |
| `^PN` | presenter cycle, KR403 kiosk only | `[ ]` | `[ ]` | `[ ]` |
| `^JW` | set ribbon tension, PAX only | `[ ]` | `[ ]` | `[ ]` |

## Clock & time

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^ST` | set date and time | `[x]` | `[x]` | `[ ]` |
| `^KD` | date and time format | `[x]` | `[x]` | `[ ]` |
| `^SO` | real-time clock offset | `[x]` | `[x]` | `[ ]` |
| `^SL` | clock mode and language | `[x]` | `[x]` | `[ ]` |

## Encoding & language

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^KL` | define language | `[x]` | `[x]` | `[ ]` |
| `^SE` | encoding table | `[x]` | `[x]` | `[ ]` |
| `^SZ` | set ZPL mode | `[x]` | `[x]` | `[ ]` |

## Identity & access

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^KN` | printer name and description | `[x]` | `[x]` | `[ ]` |
| `^KP` | set password | `[x]` | `[x]` | `[ ]` |

## Configuration & persistence

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^JU` | configuration update | `[x]` | `[x]` | `[ ]` |
| `^CC` / `~CC` | change caret | `[x]` | `[x]` | `[ ]` |
| `^CD` / `~CD` | change delimiter | `[x]` | `[x]` | `[ ]` |
| `^CT` / `~CT` | change tilde | `[x]` | `[x]` | `[ ]` |
| `^CM` | change memory letter assignment | `[ ]` | `[~]` | `[ ]` |

## Hardware control & calibration

Printer-side control, calibration and device actions; most need a connection or feedback from the device.

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `~JA` | cancel all | `[ ]` | `[~]` | `[ ]` |
| `^JB` | initialize flash memory | `[ ]` | `[~]` | `[ ]` |
| `~JB` | reset optional memory | `[ ]` | `[~]` | `[ ]` |
| `~JC` | media sensor calibration | `[ ]` | `[~]` | `[ ]` |
| `~JD` | enable communications diagnostics | `[ ]` | `[~]` | `[ ]` |
| `~JE` | disable communications diagnostics | `[ ]` | `[~]` | `[ ]` |
| `~JF` | set battery condition, PA400 and PT400 only | `[ ]` | `[ ]` | `[ ]` |
| `~JG` | graphing sensor calibration | `[ ]` | `[~]` | `[ ]` |
| `^JI` / `~JI` | start ZBI | `[ ]` | `[~]` | `[ ]` |
| `^JJ` | set auxiliary port | `[ ]` | `[~]` | `[ ]` |
| `^JS` | sensor select | `[ ]` | `[~]` | `[ ]` |
| `~JL` | set label length | `[ ]` | `[~]` | `[ ]` |
| `^JM` | dots per millimeter | `[x]` | `[x]` | `[ ]` |
| `~JN` | printhead test fatal | `[ ]` | `[~]` | `[ ]` |
| `~JO` | printhead test non-fatal | `[ ]` | `[~]` | `[ ]` |
| `~JP` | pause and cancel format | `[ ]` | `[~]` | `[ ]` |
| `~JQ` | terminate ZBI | `[ ]` | `[~]` | `[ ]` |
| `~JR` | power on reset | `[ ]` | `[~]` | `[ ]` |
| `~JX` | cancel partial format | `[ ]` | `[~]` | `[ ]` |
| `~RO` | reset advanced counter | `[ ]` | `[~]` | `[ ]` |
| `^SC` | set serial communications | `[ ]` | `[~]` | `[ ]` |
| `^SI` | set sensor intensity | `[ ]` | `[~]` | `[ ]` |
| `^SP` | start print at dot row, throughput hint only | `[ ]` | `[ ]` | `[ ]` |
| `^SQ` | halt ZebraNet alert | `[ ]` | `[~]` | `[ ]` |
| `^SR` | set printhead resistance | `[ ]` | `[~]` | `[ ]` |
| `^SS` | set media sensors | `[ ]` | `[~]` | `[ ]` |
| `^SX` | set ZebraNet alert | `[ ]` | `[~]` | `[ ]` |
| `^TO` | transfer object | `[ ]` | `[~]` | `[ ]` |
| `~WC` | print configuration label | `[ ]` | `[~]` | `[ ]` |
| `^WD` | print directory label | `[ ]` | `[~]` | `[ ]` |
| `~WQ` | write query | `[ ]` | `[~]` | `[ ]` |
| `^KV` | cutter and presenter settings, KR403 only | `[ ]` | `[ ]` | `[ ]` |
| `^XS` | set dynamic media calibration | `[ ]` | `[~]` | `[ ]` |
| `~PM` | decommissioning mode | `[ ]` | `[~]` | `[ ]` |
| `^ZZ` | printer sleep, PA400 and PT400 only | `[ ]` | `[ ]` | `[ ]` |
| `^CP` | eject or retract a presented page, KR403 only | `[ ]` | `[ ]` | `[ ]` |
| `~KB` | kill battery | `[ ]` | `[~]` | `[ ]` |

## Host communication

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `~HB` | battery status, mobile printers only | `[ ]` | `[ ]` | `[ ]` |
| `~HD` | printhead diagnostic | `[ ]` | `[~]` | `[ ]` |
| `^HF` | host format | `[ ]` | `[~]` | `[ ]` |
| `^HG` | host graphic | `[ ]` | `[~]` | `[ ]` |
| `^HH` | configuration label return | `[ ]` | `[~]` | `[ ]` |
| `~HI` | host identification | `[ ]` | `[~]` | `[ ]` |
| `~HM` | host RAM status | `[ ]` | `[~]` | `[ ]` |
| `~HQ` | host query | `[ ]` | `[~]` | `[ ]` |
| `~HS` | host status return | `[ ]` | `[~]` | `[ ]` |
| `^HT` | host linked fonts list | `[ ]` | `[~]` | `[ ]` |
| `~HU` | ZebraNet alert configuration | `[ ]` | `[~]` | `[ ]` |
| `^HV` | host verification | `[ ]` | `[~]` | `[ ]` |
| `^HW` | host directory | `[ ]` | `[~]` | `[ ]` |
| `^HY` | upload graphics | `[ ]` | `[x]` | `[ ]` |
| `^HZ` | display description information | `[ ]` | `[~]` | `[ ]` |

## RFID

Needs an R-series printer, which no test device covers; modelled rows are
spec-only. Stage A: ^RS/^RB/^RW settings. Stage B: ^RF write element plus its
password-coupled ^RL. Read-back stays native. ^RM/^RR folded into ^RS,
^RN/~RV dropped from the current guide; all four passthrough only.

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^RF` | read / write RFID | `[~]` | `[~]` | `[ ]` |
| `^RI` | get tag ID | `[ ]` | `[~]` | `[ ]` |
| `^RM` | enable motion, pre-Link-OS, folded into ^RS | `[ ]` | `[ ]` | `[ ]` |
| `^RN` | detect multiple tags, pre-Link-OS, absent from guide | `[ ]` | `[ ]` | `[ ]` |
| `^RR` | RFID retries, pre-Link-OS, folded into ^RS | `[ ]` | `[ ]` | `[ ]` |
| `^RB` | define EPC data structure | `[x]` | `[x]` | `[ ]` |
| `^RS` | RFID setup | `[x]` | `[x]` | `[ ]` |
| `^RT` | read tag | `[ ]` | `[~]` | `[ ]` |
| `^WT` | legacy RFID write, superseded by ^RF | `[ ]` | `[ ]` | `[ ]` |
| `^RU` | read unique chip serialisation | `[ ]` | `[~]` | `[ ]` |
| `~RV` | report encoding result, pre-Link-OS, absent from guide | `[ ]` | `[ ]` | `[ ]` |
| `^RW` | set read and write power | `[x]` | `[x]` | `[ ]` |
| `^RL` | lock / permalock tag memory | `[~]` | `[~]` | `[ ]` |
| `^HR` | calibrate RFID tag position | `[ ]` | `[~]` | `[ ]` |
| `^HL` / `~HL` | RFID data log | `[ ]` | `[~]` | `[ ]` |

## Network

| Command | Name | Web | Desktop | Lint |
|---|---|:-:|:-:|:-:|
| `^NB` | check for wired print server at boot | `[ ]` | `[~]` | `[ ]` |
| `^NC` | select wired / wireless primary device | `[ ]` | `[~]` | `[ ]` |
| `~NC` | network connect, legacy RS-485 only | `[ ]` | `[ ]` | `[ ]` |
| `^NI` | network ID, legacy RS-485 only | `[ ]` | `[ ]` | `[ ]` |
| `^NN` | set SNMP | `[ ]` | `[~]` | `[ ]` |
| `^NP` | boot settings source: printer vs print server | `[ ]` | `[~]` | `[ ]` |
| `~NR` | set all transparent, legacy RS-485 only | `[ ]` | `[ ]` | `[ ]` |
| `^NT` | set SMTP | `[ ]` | `[~]` | `[ ]` |
| `~NT` | set connected printer transparent, legacy RS-485 only | `[ ]` | `[ ]` | `[ ]` |
| `^NW` | web auth timeout | `[ ]` | `[~]` | `[ ]` |
| `^KC` | set client identifier | `[ ]` | `[~]` | `[ ]` |
| `^ND` | change network settings | `[ ]` | `[~]` | `[ ]` |
| `^NS` | change wired network settings | `[ ]` | `[~]` | `[ ]` |
| `^WA` | set antenna parameters | `[ ]` | `[~]` | `[ ]` |
| `^WE` | set WEP mode, obsolete, use ^WX | `[ ]` | `[ ]` | `[ ]` |
| `^WL` | set LEAP, obsolete, use ^WX | `[ ]` | `[ ]` | `[ ]` |
| `^WP` | set wireless password | `[ ]` | `[~]` | `[ ]` |
| `^WR` | set transmit rate | `[ ]` | `[~]` | `[ ]` |
| `^WS` | set wireless radio card values | `[ ]` | `[~]` | `[ ]` |
| `^WX` | configure wireless security | `[ ]` | `[~]` | `[ ]` |
| `~WL` | print network configuration label | `[ ]` | `[~]` | `[ ]` |
| `~WR` | reset wireless radio card | `[ ]` | `[~]` | `[ ]` |
<!-- coverage:end -->
