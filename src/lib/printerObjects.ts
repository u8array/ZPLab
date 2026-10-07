import { fontSampleZpl, type SampleMedia } from "@zplab/core/lib/fontSample";
import { rasterFromGfa } from "@zplab/core/lib/gfaDecode";
import { hostObjectKind, hostObjectPath, parseHostDirectories, parseHostGraphic, type HostDirectory, type HostGraphic, type HostObject } from "@zplab/core/lib/hostDirectory";
import { STORAGE_DEVICES } from "@zplab/core/lib/storagePath";
import { bitmapToDataUrl, fetchPrinterPreview } from "./printerPreview";
import { queryPrinter, type PrinterOutcome, type PrinterQueryFailure } from "./printerQuery";
import type { QueryTarget } from "./printTarget";
import { sendZplUsb } from "./usbPrint";
import { sendViaNetwork } from "./zebraPrint";
import { contentBounds, cropBitmap, type PrinterBitmap } from "./zebraGraphic";

/** One ^HW per drive and per query, so a slow drive cannot cut the next one off at the idle gap. A drive that goes silent ends the walk and keeps the earlier listings. */
export async function readPrinterObjects(target: QueryTarget, onStep?: (command: string) => void): Promise<PrinterOutcome<HostDirectory[]>> {
  const directories: HostDirectory[] = [];
  for (const device of STORAGE_DEVICES) {
    const command = `^HW${device}:*.*`;
    onStep?.(command);
    const res = await queryPrinter(target, `^XA${command}^XZ`);
    if (res.kind !== "ok") return directories.length > 0 ? { kind: "ok", value: directories } : res;
    directories.push(...parseHostDirectories(res.value));
  }
  return directories.length > 0 ? { kind: "ok", value: directories } : { kind: "unparsed" };
}

export async function readPrinterGraphic(target: QueryTarget, object: HostObject): Promise<PrinterOutcome<HostGraphic>> {
  const res = await queryPrinter(target, `^XA^HG${hostObjectPath(object)}^XZ`);
  if (res.kind !== "ok") return res;
  const graphic = parseHostGraphic(res.value);
  return graphic ? { kind: "ok", value: graphic } : { kind: "unparsed" };
}

/** The sample the printer draws for one font, cropped to the ink. Null when it drew nothing. */
export async function readPrinterFontSample(target: QueryTarget, object: HostObject, media: SampleMedia): Promise<PrinterOutcome<PrinterBitmap | null>> {
  const res = await fetchPrinterPreview(target, fontSampleZpl(hostObjectPath(object), media));
  if (res.kind !== "ok") return res;
  const bounds = contentBounds(res.value);
  return { kind: "ok", value: bounds.right > bounds.left ? cropBitmap(res.value, bounds) : null };
}

function graphicDataUrl(graphic: HostGraphic): string | null {
  const raster = rasterFromGfa(graphic.gfa);
  return raster ? bitmapToDataUrl({ width: raster.paddedWidth, height: raster.heightDots, mono: raster.bytes }) : null;
}

/** A data URL of the object, a stored graphic or a drawn font sample. Null when nothing is drawable. */
export async function readPrinterObjectImage(target: QueryTarget, object: HostObject, media: SampleMedia): Promise<PrinterOutcome<string | null>> {
  if (hostObjectKind(object.ext) === "font") {
    const sample = await readPrinterFontSample(target, object, media);
    return sample.kind === "ok" ? { kind: "ok", value: sample.value && bitmapToDataUrl(sample.value) } : sample;
  }
  const graphic = await readPrinterGraphic(target, object);
  return graphic.kind === "ok" ? { kind: "ok", value: graphicDataUrl(graphic.value) } : graphic;
}

/** ^ID answers nothing, so it goes the way a job goes. */
export async function deletePrinterObject(target: QueryTarget, object: HostObject): Promise<PrinterQueryFailure | undefined> {
  const zpl = `^XA^ID${hostObjectPath(object)}^FS^XZ`;
  if (target.kind === "usb") {
    const res = await sendZplUsb(target.id, zpl);
    return res.kind === "sent" ? undefined : res;
  }
  const res = await sendViaNetwork(target.host, target.port, zpl);
  switch (res.kind) {
    case "sent":
    case "responded":
      return undefined;
    case "refused":
      return { kind: "refused", port: target.port };
    case "unreachable":
    case "no_response":
    case "error":
      return { kind: "unreachable" };
  }
}
