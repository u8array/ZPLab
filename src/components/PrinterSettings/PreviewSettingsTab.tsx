import { useState, useEffect } from "react";
import { useT } from "../../hooks/useT";
import { useLabelStore, selectEffectivePreviewProvider } from "../../store/labelStore";
import { isDesktopShell } from "../../lib/platform";
import { isDefaultHost } from "../../lib/labelary";
import { labelCls, inputCls, buttonCls } from "../ui/formStyles";
import { RadioOption } from "../ui/RadioOption";
import { formatTemplate } from "../../lib/formatTemplate";
import { previewProviderLabel } from "../../lib/previewProviderLabel";

/** Preview configuration: which renderer draws the overlay and the Labelary privacy consent. */
export function PreviewSettingsTab() {
  const t = useT();
  const loc = t.printerSettings.preview;

  // The radio shows the stored choice, so a click always commits. A degraded build names what renders instead.
  const chosen = useLabelStore((s) => s.previewProvider);
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

  const setPrinterSettingsTab = useLabelStore((s) => s.setPrinterSettingsTab);

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
          current={chosen}
          onSelect={setProvider}
          label={loc.providerLabelary}
          disabled={!labelaryAvailable}
        />
        <RadioOption
          name="preview-provider"
          value="printer"
          current={chosen}
          onSelect={setProvider}
          label={loc.providerPrinter}
          hint={isDesktopShell ? loc.providerPrinterHint : loc.providerPrinterDesktopOnly}
          disabled={!isDesktopShell}
        />
        <RadioOption
          name="preview-provider"
          value="none"
          current={chosen}
          onSelect={setProvider}
          label={loc.providerNone}
          hint={loc.providerNoneHint}
        />
        {provider !== chosen && (
          <span className="text-[10px] text-muted">
            {formatTemplate(loc.providerInUseFmt, { provider: previewProviderLabel(t, provider) })}
          </span>
        )}
      </section>

      {provider === "printer" && isDesktopShell && (
        <section className="flex items-center gap-3">
          <span className="text-[10px] text-muted">{loc.printerTargetHint}</span>
          <button type="button" className={buttonCls} onClick={() => setPrinterSettingsTab("printTarget")}>
            {t.printerSettings.tabs.printTarget}
          </button>
        </section>
      )}

      {labelaryAvailable && chosen === "labelary" && (
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

      {/* Consent is a standing grant for every Labelary action, printing included, so it never hides behind the renderer. */}
      {labelaryAvailable && (
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
