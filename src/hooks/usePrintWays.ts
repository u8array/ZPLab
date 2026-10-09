import { isDesktopShell } from "../lib/platform";
import { effectivePrintWay, renderableOutput, type OutputFacts, type OutputSource } from "../lib/outputChoice";
import { offeredWays, type PrintTransport, type PrintWay } from "../lib/printTarget";
import { useLabelStore } from "../store/labelStore";
import { useBrowserPrintDevices, useLocalPrinters, useUsbPrinters } from "./usePrintDevices";

/** Each list keeps its own enumeration state, so the strip and the body must read the same mount. */
export interface PrintDeviceLists {
  bp: ReturnType<typeof useBrowserPrintDevices>;
  local: ReturnType<typeof useLocalPrinters>;
  usb: ReturnType<typeof useUsbPrinters>;
}

export interface PrintWays {
  offered: PrintWay[];
  way: PrintWay;
  /** The Zebra way behind the strip, which the system way leaves untouched. */
  tab: PrintTransport;
  choose: (way: PrintWay) => void;
  devices: PrintDeviceLists;
}

/** The ways out of the output dialog and the one it shows. */
export function usePrintWays(source: OutputSource, facts: OutputFacts): PrintWays {
  const bp = useBrowserPrintDevices();
  const local = useLocalPrinters(isDesktopShell);
  const usb = useUsbPrinters(isDesktopShell);
  const transport = useLabelStore((s) => s.printTarget.transport);
  const printWay = useLabelStore((s) => s.outputChoice.printWay);
  const choose = useLabelStore((s) => s.chooseOutputWay);

  const offered = offeredWays(isDesktopShell, { local: local.present, usb: usb.present }, renderableOutput(source, facts));
  return { offered, ...effectivePrintWay(printWay, transport, offered), choose, devices: { bp, local, usb } };
}
