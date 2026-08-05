export interface TestCase {
  id: string;
  zpl_input: string;
  expected_bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  image_ref: string;
}

export const testCases: TestCase[] = [
  {
    id: "barcode_code128_standard",
    zpl_input: "^XA^BY2^FO50,50^BCN,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_code128_standard.png",
  },
  {
    id: "barcode_code128_ft_n",
    zpl_input: "^XA^BY2^FT300,300^BCN,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 300, y: 200, width: 202, height: 100 },
    image_ref: "barcode_code128_ft_n.png",
  },
  {
    id: "barcode_code128_ft_r",
    zpl_input: "^XA^BY2^FT300,300^BCR,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 300, y: 300, width: 100, height: 202 },
    image_ref: "barcode_code128_ft_r.png",
  },
  {
    id: "barcode_code128_ft_i",
    zpl_input: "^XA^BY2^FT300,300^BCI,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 98, y: 300, width: 202, height: 100 },
    image_ref: "barcode_code128_ft_i.png",
  },
  {
    id: "barcode_code128_ft_b",
    zpl_input: "^XA^BY2^FT300,300^BCB,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 200, y: 98, width: 100, height: 202 },
    image_ref: "barcode_code128_ft_b.png",
  },
  {
    id: "barcode_code128_small_no_text",
    zpl_input: "^XA^BY1^FO100,100^BCN,50,N,N,N^FDTEST^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 100, height: 50 },
    image_ref: "barcode_code128_small_no_text.png",
  },
  {
    id: "barcode_code128_large_check_digit",
    zpl_input: "^XA^BY3^FO20,20^BCN,150,N,N,Y^FD98765^FS^XZ",
    expected_bounds: { x: 20, y: 20, width: 300, height: 150 },
    image_ref: "barcode_code128_large_check_digit.png",
  },
  {
    id: "barcode_qr_standard",
    zpl_input: "^XA^FO50,50^BQN,2,4^FDQA,Hello World^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 100, height: 100 },
    image_ref: "barcode_qr_standard.png",
  },
  {
    id: "barcode_qr_large_high_ec",
    zpl_input:
      "^XA^FO150,150^BQN,2,8^FDHA,Zebra Print Lab QR Code Testing^FS^XZ",
    expected_bounds: { x: 150, y: 150, width: 250, height: 250 },
    image_ref: "barcode_qr_large_high_ec.png",
  },
  {
    id: "barcode_ean13_standard",
    zpl_input: "^XA^BY2^FO50,50^BEN,100,N,N^FD123456789012^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_ean13_standard.png",
  },
  {
    id: "barcode_datamatrix_standard",
    zpl_input: "^XA^FO50,50^BXN,5,200^FDDataMatrixTest^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 100, height: 100 },
    image_ref: "barcode_datamatrix_standard.png",
  },
  {
    id: "barcode_code39_standard",
    zpl_input: "^XA^BY2^FO50,50^B3N,N,100,N,N^FDCODE39^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_code39_standard.png",
  },
  {
    id: "barcode_pdf417_standard",
    zpl_input: "^XA^BY2^FO50,50^B7N,10,1,4,,,^FD1234567890^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 274, height: 30 },
    image_ref: "barcode_pdf417_standard.png",
  },
  {
    id: "barcode_upca_standard",
    zpl_input: "^XA^BY2^FO50,50^BUN,100,N,N,Y^FD01234567890^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_upca_standard.png",
  },
  {
    id: "barcode_ean8_standard",
    zpl_input: "^XA^BY2^FO50,50^B8N,100,N,N^FD1234567^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_ean8_standard.png",
  },
  {
    id: "barcode_aztec_standard",
    zpl_input: "^XA^FO50,50^B0N,4,N,0^FDAztec123^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 100, height: 100 },
    image_ref: "barcode_aztec_standard.png",
  },
  {
    id: "barcode_interleaved2of5_standard",
    zpl_input: "^XA^BY2^FO50,50^B2N,100,N,N,N^FD12345678^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_interleaved2of5_standard.png",
  },
  {
    id: "barcode_micropdf417_standard",
    zpl_input: "^XA^BY2^FO50,50^BFN,2,0^FD1234^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_micropdf417_standard.png",
  },
  {
    id: "barcode_codablock_standard",
    zpl_input: "^XA^BY2^FO50,50^BBN,2,Y^FD1234567890^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 200, height: 100 },
    image_ref: "barcode_codablock_standard.png",
  },
  {
    id: "barcode_pdf417_auto",
    zpl_input: "^XA^BY2^FO50,50^B7N,10,1,0,,,^FD1234567890^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 172, height: 100 },
    image_ref: "barcode_pdf417_auto.png",
  },
  {
    // securityLevel=0 (auto ECC = ECC level 0), columns=0 (auto).
    // Labelary measures: cols=1, 8 rows → height=32 dots, width=172 dots.
    id: "barcode_pdf417_auto_ecc",
    zpl_input: "^XA^BY2^FO50,50^B7N,4,0,0,,,^FD1234567890^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 172, height: 32 },
    image_ref: "barcode_pdf417_auto_ecc.png",
  },
  // Auto-columns probes beyond the original 10-49 char calibration range
  // (mixed text, higher ECC, numeric compaction). Bounds Labelary-measured
  // via tests/scripts/measure_bbox.ts after the fixture fetch.
  {
    id: "barcode_pdf417_auto_long60",
    zpl_input: "^XA^BY2^FO50,50^B7N,10,0,0,,,^FDABCDEFGHIJ0123456789ABCDEFGHIJ0123456789ABCDEFGHIJ0123456789^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 206, height: 180 },
    image_ref: "barcode_pdf417_auto_long60.png",
  },
  {
    id: "barcode_pdf417_auto_long90_sec2",
    zpl_input: "^XA^BY2^FO50,50^B7N,10,2,0,,,^FDABCDEFGHIJ0123456789ABCDEFGHIJ0123456789ABCDEFGHIJ0123456789ABCDEFGHIJ0123456789ABCDEFGHIJ^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 240, height: 200 },
    image_ref: "barcode_pdf417_auto_long90_sec2.png",
  },
  {
    id: "barcode_pdf417_auto_long120",
    zpl_input: "^XA^BY2^FO50,50^B7N,10,0,0,,,^FD012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 240, height: 160 },
    image_ref: "barcode_pdf417_auto_long120.png",
  },
  {
    id: "barcode_code93_standard",
    zpl_input: "^XA^BY2^FO50,50^BAN,100,N,N,N^FDCODE93^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 182, height: 100 },
    image_ref: "barcode_code93_standard.png",
  },
  {
    id: "barcode_code11_standard",
    zpl_input: "^XA^BY2^FO50,50^B1N,N,100,N,N^FD12345^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 178, height: 100 },
    image_ref: "barcode_code11_standard.png",
  },
  {
    id: "barcode_industrial2of5_standard",
    zpl_input: "^XA^BY2^FO50,50^BIN,100,N,N^FD12345678^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 262, height: 100 },
    image_ref: "barcode_industrial2of5_standard.png",
  },
  {
    id: "barcode_standard2of5_standard",
    zpl_input: "^XA^BY2^FO50,50^BJN,100,N,N^FD12345678^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 242, height: 100 },
    image_ref: "barcode_standard2of5_standard.png",
  },
  {
    id: "barcode_codabar_standard",
    zpl_input: "^XA^BY2^FO50,50^BKN,N,100,N,N^FDA12345A^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 174, height: 100 },
    image_ref: "barcode_codabar_standard.png",
  },
  {
    id: "barcode_logmars_standard",
    zpl_input: "^XA^BY2^FO50,50^BLN,100,N^FDLOGMARS1^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 350, height: 120 },
    image_ref: "barcode_logmars_standard.png",
  },
  {
    id: "barcode_logmars_with_text",
    zpl_input: "^XA^BY2^FO50,50^BLN,100,Y^FDLOGMARS1^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 350, height: 120 },
    image_ref: "barcode_logmars_with_text.png",
  },
  {
    id: "barcode_msi_standard",
    zpl_input: "^XA^BY2,2^FO50,50^BMN,A,100,N,N^FD12345678^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 206, height: 100 },
    image_ref: "barcode_msi_standard.png",
  },
  {
    id: "barcode_plessey_standard",
    zpl_input: "^XA^BY2,2^FO50,50^BPN,N,100,N,N^FD12345678^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 294, height: 100 },
    image_ref: "barcode_plessey_standard.png",
  },
  {
    id: "barcode_planet_standard",
    zpl_input: "^XA^BY2^FO50,50^B5N,100,N,N^FD12345678901^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 307, height: 100 },
    image_ref: "barcode_planet_standard.png",
  },
  {
    id: "barcode_postal_standard",
    zpl_input: "^XA^BY2^FO50,50^BZN,100,N,N^FD12345^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 157, height: 100 },
    image_ref: "barcode_postal_standard.png",
  },
  {
    id: "barcode_gs1databar_standard",
    zpl_input: "^XA^BY2^FO50,50^BRN,1,2,2,100^FD0112345678901^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 192, height: 66 },
    image_ref: "barcode_gs1databar_standard.png",
  },
  {
    id: "barcode_gs1databar_truncated",
    zpl_input: "^XA^BY2^FO50,50^BRN,2,2,2,100^FD0112345678901^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 192, height: 26 },
    image_ref: "barcode_gs1databar_truncated.png",
  },
  {
    id: "barcode_gs1databar_stacked",
    zpl_input: "^XA^BY2^FO50,50^BRN,3,2,2,100^FD0112345678901^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 100, height: 28 },
    image_ref: "barcode_gs1databar_stacked.png",
  },
  {
    id: "barcode_gs1databar_stacked_omni",
    zpl_input: "^XA^BY2^FO50,50^BRN,4,2,2,100^FD0112345678901^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 100, height: 144 },
    image_ref: "barcode_gs1databar_stacked_omni.png",
  },
  {
    id: "barcode_gs1databar_limited",
    zpl_input: "^XA^BY2^FO50,50^BRN,5,2,2,100^FD0112345678901^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 148, height: 20 },
    image_ref: "barcode_gs1databar_limited.png",
  },
  {
    id: "barcode_gs1databar_expanded",
    zpl_input: "^XA^BY2^FO50,50^BRN,6,2,2,100^FD0112345678901231^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 266, height: 68 },
    image_ref: "barcode_gs1databar_expanded.png",
  },
  // Note: Expanded Stacked (symbology 7) is intentionally not Labelary-validated.
  // bwip-js requires "(01)…" parens-AI input; Labelary's ^BR sym 7 silently rejects
  // that format and renders an empty PNG, so dimensions cannot be cross-validated.
  // The ZPL roundtrip is covered by a unit test in zplGenerator.test.ts.
  {
    id: "barcode_upce_standard",
    zpl_input: "^XA^BY2^FO50,50^B9N,100,N,Y^FD012345^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 102, height: 113 },
    image_ref: "barcode_upce_standard.png",
  },

  // ── Rotation coverage ─────────────────────────────────────────────────────
  // Bounds measured from the Labelary PNG via tests/scripts/measure_bbox.ts.
  // R/B swap width and height of the unrotated symbol; the QR +10 dot Y offset
  // applies to rotated QR codes too.
  {
    id: "barcode_code128_rot_R",
    zpl_input: "^XA^BY2^FO100,100^BCR,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 100, height: 202 },
    image_ref: "barcode_code128_rot_R.png",
  },
  {
    id: "barcode_code128_rot_I",
    zpl_input: "^XA^BY2^FO100,100^BCI,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 202, height: 100 },
    image_ref: "barcode_code128_rot_I.png",
  },
  {
    id: "barcode_code128_rot_B",
    zpl_input: "^XA^BY2^FO100,100^BCB,100,N,N,N^FD123456^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 100, height: 202 },
    image_ref: "barcode_code128_rot_B.png",
  },
  {
    id: "barcode_datamatrix_rot_R",
    zpl_input: "^XA^FO100,100^BXR,5,200^FDDataMatrixTest^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 90, height: 90 },
    image_ref: "barcode_datamatrix_rot_R.png",
  },
  // Code39 (^B3) and EAN13 (^BE) use different param orders than Code128's
  // ^BC, so cover them too. Bounds populated via measure_bbox.ts.
  {
    id: "barcode_code39_rot_R",
    zpl_input: "^XA^BY2^FO100,100^B3R,N,100,N,N^FDCODE39^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 100, height: 254 },
    image_ref: "barcode_code39_rot_R.png",
  },
  {
    id: "barcode_code39_rot_B",
    zpl_input: "^XA^BY2^FO100,100^B3B,N,100,N,N^FDCODE39^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 100, height: 254 },
    image_ref: "barcode_code39_rot_B.png",
  },
  // EAN13 has extended guard bars that extend past the bar-height baseline.
  // After R rotation those guards sit LEFT of the FO anchor (ink at x=87 with
  // FO=100), so the bbox starts to the left of obj.x. The B rotation keeps the
  // ink within the FO-anchored corner.
  {
    id: "barcode_ean13_rot_R",
    zpl_input: "^XA^BY2^FO100,100^BER,100,N,N^FD123456789012^FS^XZ",
    expected_bounds: { x: 87, y: 100, width: 113, height: 190 },
    image_ref: "barcode_ean13_rot_R.png",
  },
  {
    id: "barcode_ean13_rot_B",
    zpl_input: "^XA^BY2^FO100,100^BEB,100,N,N^FD123456789012^FS^XZ",
    expected_bounds: { x: 100, y: 100, width: 113, height: 190 },
    image_ref: "barcode_ean13_rot_B.png",
  },
  // UPC/EAN supplements (^BS): the human-readable digits print ABOVE
  // the bars per Zebra firmware (and Labelary). bbox top sits 18 dots
  // above the FO anchor; total height = bar height + 18.
  // ^BS visual regression uses printInterpretation=N for a bars-only
  // comparison — bwip-js and Zebra ship slightly different glyph
  // shapes for the supplement digits, which would exceed the strict
  // ALLOWED_TOLERANCE. The text-zone reservation is still asserted
  // structurally by labelarySync.test.ts against this fixture's
  // expected_bounds (which include the 18-dot zone above the bars).
  {
    id: "barcode_upcean_supp5_standard",
    zpl_input: "^XA^BY2^FO50,50^BSN,80,N^FD51999^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 94, height: 80 },
    image_ref: "barcode_upcean_supp5_standard.png",
  },
  {
    id: "barcode_upcean_supp2_standard",
    zpl_input: "^XA^BY2^FO50,50^BSN,80,N^FD42^FS^XZ",
    expected_bounds: { x: 50, y: 50, width: 40, height: 80 },
    image_ref: "barcode_upcean_supp2_standard.png",
  },
];
