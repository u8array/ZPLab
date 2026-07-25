import { useState, useEffect } from "react";
import { useT } from "../../hooks/useT";
import { useLabelStore, selectEffectivePreviewProvider } from "../../store/labelStore";
import { isDesktopShell } from "../../lib/platform";
import { isDefaultHost } from "../../lib/labelary";
import {
  getPreviewTransport,
  getPrinterAddress,
  setPreviewTransport,
  setPrinterAddress,
  type PreviewTransport,
} from "../../lib/printerAddress";
import { isLikelyZebra } from "../../lib/usbPrint";
import { printerOptionLabel } from "../../lib/printerLabel";
import { useUsbPrinters } from "../../hooks/useUsbPrinters";
import { labelCls, inputCls, buttonCls } from "../ui/formStyles";
import { Select } from "../ui/Select";

function RadioOption<T extends string>({ name, value, current, onSelect, label, hint, disabled }: {
  name: string;
  value: T;
  current: T;
  onSelect: (v: T) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className={`flex items-center gap-2 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          type="radio"
          name={name}
          className="accent-accent"
          checked={current === value}
          disabled={disabled}
          onChange={() => onSelect(value)}
        />
        <span className={labelCls}>{label}</span>
      </label>
      {hint && <span className="text-[10px] text-muted pl-6">{hint}</span>}
    </div>
  );
}

/** Preview configuration: which renderer draws the overlay (Labelary's
 *  software approximation vs the connected printer's own firmware) plus the
 *  Labelary privacy consent and the printer's network address. */
export function PreviewSettingsTab() {
  const t = useT();
  const loc = t.printerSettings.preview;

  // Effective (not raw) provider: a persisted 'printer' choice degrades to
  // Labelary in the web build, so the radio reflects what actually renders.
  const provider = useLabelStore(selectEffectivePreviewProvider);
  const setProvider = useLabelStore((s) => s.setPreviewProvider);
  const labelaryAvailable = useLabelStore((s) => s.thirdParty.labelary);
  const labelaryConsent = useLabelStore((s) => s.labelaryNoticeAcknowledged);
  const acknowledgeLabelaryNotice = useLabelStore((s) => s.acknowledgeLabelaryNotice);
  const revokeLabelaryNotice = useLabelStore((s) => s.revokeLabelaryNotice);

  const storeHost = useLabelStore((s) => s.labelaryHost);
  const storeKey = useLabelStore((s) => s.labelaryApiKey);
  const setLabelaryHost = useLabelStore((s) => s.setLabelaryHost);
  const saveLabelaryApiKey = useLabelStore((s) => s.saveLabelaryApiKey);
  const hydrateLabelaryApiKey = useLabelStore((s) => s.hydrateLabelaryApiKey);

  // Address, USB device, and transport are shared with the print dialog via
  // localStorage, not the store; local state mirrors them for controlled
  // inputs (address persisted on blur, the others on change).
  const [address, setAddress] = useState(() => {
    const a = getPrinterAddress();
    return { host: a.host, port: String(a.port) };
  });
  const [transport, setTransport] = useState<PreviewTransport>(getPreviewTransport);
  const selectTransport = (v: PreviewTransport) => {
    setTransport(v);
    setPreviewTransport(v);
  };
  // Shared with the print dialog; enumerate only when the printer provider can
  // consume the result.
  const usb = useUsbPrinters(isDesktopShell && provider === "printer");
  // Unplugging every USB printer hides the transport section; render the
  // stranded 'usb' choice as network without persisting it, so a replug
  // restores the selection (mirrors the print dialog's stranded-tab fix).
  const usbAvailable = usb.printers.length > 0;
  const effectiveTransport: PreviewTransport = usbAvailable ? transport : "network";
  const persistAddress = () => {
    setPrinterAddress(address.host.trim(), address.port);
    // Snap the inputs to the validated values (host trimmed, an invalid/empty
    // port defaulted to 9100) so the display matches what the preview uses.
    const a = getPrinterAddress();
    setAddress({ host: a.host, port: String(a.port) });
  };

  // Host and key inputs use a `draft` (null = show the store value): the field
  // tracks the store until the user edits, then holds their text so a late
  // async change (hydrate) can't clobber in-progress typing. Committing resets
  // the draft to null so the field snaps to the persisted value.
  const [hostDraft, setHostDraft] = useState<string | null>(null);
  const hostValue = hostDraft ?? storeHost;
  const persistHost = () => {
    setLabelaryHost(hostValue);
    setHostDraft(null);
  };

  // Retry the credential-store load on open (a startup hydrate may have
  // failed). Persist only via an explicit Save: a keychain write can raise an
  // OS unlock prompt, so it must be deliberate, not an incidental blur.
  const migrateLabelaryKey = useLabelStore((s) => s.migrateLabelaryKey);
  useEffect(() => {
    // Retry of the startup migration + hydrate; a keychain failure must not
    // surface as an unhandled rejection or skip the hydrate.
    void migrateLabelaryKey().catch(() => undefined).then(hydrateLabelaryApiKey);
  }, [hydrateLabelaryApiKey, migrateLabelaryKey]);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  // Desktop keeps the key in the keychain only (never hydrated into the store),
  // so the field is write-only there: it shows the draft, never a stored value.
  const keyValue = keyDraft ?? (isDesktopShell ? '' : storeKey);
  const [keySaveFailed, setKeySaveFailed] = useState(false);
  // A keychain write can raise an OS unlock prompt and take seconds; block a
  // second save (and its duplicate prompt) until this one settles.
  const [keySaving, setKeySaving] = useState(false);
  const keyDirty = isDesktopShell ? keyDraft !== null : keyValue.trim() !== storeKey;
  const saveKey = () => {
    setKeySaveFailed(false);
    setKeySaving(true);
    // Bind the key to the host the user currently sees, not a still-unblurred
    // host draft (setLabelaryHost is a no-op when unchanged).
    persistHost();
    saveLabelaryApiKey(keyValue)
      .then(() => setKeyDraft(null))
      .catch(() => setKeySaveFailed(true))
      .finally(() => setKeySaving(false));
  };

  // Consent only gates the public host; a custom endpoint is the operator's own.
  const publicHost = isDefaultHost(storeHost);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.providerHeading}</h3>
        <RadioOption
          name="preview-provider"
          value="labelary"
          current={provider}
          onSelect={setProvider}
          label={loc.providerLabelary}
          disabled={!labelaryAvailable}
        />
        <RadioOption
          name="preview-provider"
          value="printer"
          current={provider}
          onSelect={setProvider}
          label={loc.providerPrinter}
          hint={isDesktopShell ? loc.providerPrinterHint : loc.providerPrinterDesktopOnly}
          disabled={!isDesktopShell}
        />
      </section>

      {provider === "printer" && usbAvailable && (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.transportHeading}</h3>
          <RadioOption
            name="preview-transport"
            value="network"
            current={effectiveTransport}
            onSelect={selectTransport}
            label={loc.transportNetwork}
          />
          <RadioOption
            name="preview-transport"
            value="usb"
            current={effectiveTransport}
            onSelect={selectTransport}
            label={loc.transportUsb}
          />
        </section>
      )}

      {provider === "printer" && isDesktopShell && effectiveTransport === "network" && (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.printerAddressHeading}</h3>
          <div className="flex gap-2 max-w-md">
            <div className="flex-1 flex flex-col gap-1">
              <label className={labelCls}>{t.zebraPrint.ipAddress}</label>
              <input
                type="text"
                value={address.host}
                onChange={(e) => setAddress((a) => ({ ...a, host: e.target.value }))}
                onBlur={persistAddress}
                placeholder="192.168.1.100"
                className={inputCls}
              />
            </div>
            <div className="w-24 flex flex-col gap-1">
              <label className={labelCls}>{t.zebraPrint.port}</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={address.port}
                onChange={(e) => setAddress((a) => ({ ...a, port: e.target.value }))}
                onBlur={persistAddress}
                className={inputCls}
              />
            </div>
          </div>
          <span className="text-[10px] text-muted max-w-md">{loc.printerAddressHint}</span>
        </section>
      )}

      {provider === "printer" && effectiveTransport === "usb" && (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{t.zebraPrint.printer}</h3>
          <div className="max-w-md">
            <Select<string>
              value={usb.selectedId}
              onChange={usb.select}
              disabled={usb.printers.length === 0}
              groups={[{
                options:
                  usb.printers.length === 0
                    ? [{ value: "", label: usb.loading ? t.zebraPrint.discovering : t.zebraPrint.noPrinters }]
                    : usb.printers.map((p) => ({
                        value: p.id,
                        label: printerOptionLabel(p.name, isLikelyZebra(p)),
                      })),
              }]}
            />
          </div>
          {usb.error && (
            <span className="text-[10px] font-mono text-error">{usb.error}</span>
          )}
        </section>
      )}

      {labelaryAvailable && provider === "labelary" && (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.apiHeading}</h3>
          <div className="flex flex-col gap-2 max-w-md">
            <div className="flex flex-col gap-1">
              <label className={labelCls}>{loc.apiHost}</label>
              <input
                type="text"
                value={hostValue}
                onChange={(e) => setHostDraft(e.target.value)}
                onBlur={persistHost}
                placeholder="https://api.labelary.com"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>{loc.apiKey}</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyValue}
                  onChange={(e) => {
                    setKeyDraft(e.target.value);
                    setKeySaveFailed(false);
                  }}
                  disabled={keySaving}
                  autoComplete="off"
                  className={`${inputCls} flex-1`}
                />
                <button
                  type="button"
                  className={`${buttonCls} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-2`}
                  disabled={!keyDirty || keySaving}
                  onClick={saveKey}
                >
                  {loc.apiKeySave}
                </button>
              </div>
              {keySaveFailed && (
                <span className="text-[10px] font-mono text-error">{loc.apiKeySaveError}</span>
              )}
            </div>
          </div>
          <span className="text-[10px] text-muted max-w-md">
            {isDesktopShell ? loc.apiHintDesktop : loc.apiHintWeb}
          </span>
        </section>
      )}

      {labelaryAvailable && provider === "labelary" && (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.privacyHeading}</h3>
          {publicHost && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-accent"
                checked={labelaryConsent}
                onChange={(e) => (e.target.checked ? acknowledgeLabelaryNotice() : revokeLabelaryNotice())}
              />
              <span className={labelCls}>{loc.labelaryConsent}</span>
            </label>
          )}
          <p className="text-[10px] text-muted leading-relaxed max-w-md">
            {publicHost ? (
              <>
                {t.output.previewNoticeBody}{" "}
                {/* The plans/retention link is about the public service; a
                    custom endpoint is the operator's own, so omit it there. */}
                <a
                  href="https://labelary.com/service.html#pricing"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {t.output.previewNoticePrivacyLink}
                </a>
              </>
            ) : (
              loc.labelaryHint
            )}
          </p>
        </section>
      )}
    </div>
  );
}
