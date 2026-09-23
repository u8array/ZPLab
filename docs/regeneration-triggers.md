# Whole-page regeneration

The first object edit regenerates the whole page when the source contains any of these:

- `^MU` unit scaling
- non-default `^CC`/`^CT` prefixes or a `^CD` delimiter
- non-UTF-8 `^CI` encoding
- `^FE` or `^FC` outside its field, or unused at the field's closing `^FS`
- an in-field `^FC` with an omitted parameter
- an `^FN` without a field
- `^JM` density switches
- `^CF`, `^FW`, `^CW`, `^SO`, `^LH` or `^LT` defined inside an object's source
- an `^LH` or `^LT` change after the page's first field
- `^LR`
- a barcode relying on a previous `^BY`
- Code 128 escape sequences
- QR data or settings
- an `^FN` embed form that export normalises

Reordering objects also regenerates the page.
