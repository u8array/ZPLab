import { useId } from "react";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { isDesktopShell } from "../../lib/platform";
import { formatTemplate } from "../../lib/formatTemplate";
import { labelCls } from "../ui/formStyles";
import { DangerConfirmButton } from "../ui/DangerConfirmButton";
import { Select } from "../ui/Select";
import { GitHubIcon } from "../ui/GitHubIcon";
import { localeOptions, type LocaleCode } from "../../locales";
import { openExternal, REPO_URL } from "../../lib/openExternal";

function SettingToggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="accent-accent"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hint ? hintId : undefined}
        />
        <span className={labelCls}>{label}</span>
      </label>
      {hint && <span id={hintId} className="text-[10px] text-muted pl-6">{hint}</span>}
    </div>
  );
}

/** Client-side app preferences (not printer/ZPL config): power-user mode,
 *  smart-snap, updates, and a scoped settings reset. Preview/Labelary
 *  configuration lives on its own tab (PreviewSettingsTab). */
export function AppSettingsTab() {
  const t = useT();
  const loc = t.printerSettings.app;

  const showZplCommands = useLabelStore((s) => s.showZplCommands);
  const setShowZplCommands = useLabelStore((s) => s.setShowZplCommands);
  const keepExportMetadata = useLabelStore((s) => s.keepExportMetadata);
  const setKeepExportMetadata = useLabelStore((s) => s.setKeepExportMetadata);
  const smartSnapEnabled = useLabelStore((s) => s.canvasSettings.smartSnapEnabled);
  const setCanvasSettings = useLabelStore((s) => s.setCanvasSettings);
  const resetSettings = useLabelStore((s) => s.resetSettings);
  const appUpdate = useLabelStore((s) => s.appUpdate);
  const checkForAppUpdate = useLabelStore((s) => s.checkForAppUpdate);
  const installAppUpdate = useLabelStore((s) => s.installAppUpdate);
  const relaunchApp = useLabelStore((s) => s.relaunchApp);
  const locale = useLabelStore((s) => s.locale);
  const setLocale = useLabelStore((s) => s.setLocale);
  const theme = useLabelStore((s) => s.theme);
  const setTheme = useLabelStore((s) => s.setTheme);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.appearanceHeading}</h3>
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <div className="flex flex-col gap-1">
            <span className={labelCls}>{loc.language}</span>
            <Select<LocaleCode>
              value={locale}
              onChange={setLocale}
              aria-label={loc.language}
              groups={[{ options: localeOptions() }]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelCls}>{loc.theme}</span>
            <Select<'light' | 'dark'>
              value={theme}
              onChange={setTheme}
              aria-label={loc.theme}
              groups={[{
                options: [
                  { value: 'light', label: t.app.themeLight },
                  { value: 'dark', label: t.app.themeDark },
                ],
              }]}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.editorHeading}</h3>
        <SettingToggle
          checked={showZplCommands}
          onChange={setShowZplCommands}
          label={loc.powerUser}
          hint={loc.powerUserHint}
        />
        <SettingToggle
          checked={keepExportMetadata}
          onChange={setKeepExportMetadata}
          label={loc.keepExportMetadata}
          hint={loc.keepExportMetadataHint}
        />
        <SettingToggle
          checked={smartSnapEnabled}
          onChange={(v) => setCanvasSettings({ smartSnapEnabled: v })}
          label={loc.smartSnap}
          hint={loc.smartSnapHint}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.updatesHeading}</h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-muted">
            {formatTemplate(loc.versionFmt, { version: __APP_VERSION__ })}
          </span>
          {isDesktopShell && appUpdate.phase === "available" && (
            <>
              <span className="font-mono text-[10px] text-text">
                {formatTemplate(t.app.updateAvailableFmt, { version: appUpdate.version })}
              </span>
              <button
                onClick={() => void installAppUpdate()}
                className="px-2 py-1 rounded text-[10px] font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
              >
                {t.app.updateInstall}
              </button>
            </>
          )}
          {isDesktopShell && appUpdate.phase === "installed" && (
            <button
              onClick={() => void relaunchApp()}
              className="px-2 py-1 rounded text-[10px] font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
            >
              {t.app.updateRestart}
            </button>
          )}
          {isDesktopShell && appUpdate.phase !== "available" && appUpdate.phase !== "installed" && (
            <button
              onClick={() => void checkForAppUpdate(true)}
              disabled={appUpdate.phase === "checking" || appUpdate.phase === "installing"}
              className="px-2 py-1 rounded text-[10px] font-mono border border-border bg-surface-2 hover:bg-border text-text transition-colors disabled:opacity-40"
            >
              {appUpdate.phase === "checking" ? loc.checkingUpdates : loc.checkUpdates}
            </button>
          )}
        </div>
        {appUpdate.phase === "upToDate" && (
          <span className="text-[10px] text-muted">{loc.upToDate}</span>
        )}
        {appUpdate.phase === "installing" && (
          <span className="text-[10px] text-muted">{t.app.updateInstalling}</span>
        )}
        {appUpdate.phase === "installed" && (
          <span className="text-[10px] text-muted">{t.app.updateInstalled}</span>
        )}
        {appUpdate.phase === "error" && (
          <span className="text-[10px] text-red-400">
            {formatTemplate(t.app.updateErrorFmt, { error: appUpdate.message })}
          </span>
        )}
        {/* onClick routes through openExternal: the desktop webview sandboxes
            target=_blank, so the anchor alone would be dead there. */}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            openExternal(REPO_URL);
          }}
          className="flex items-center gap-1.5 text-[10px] font-mono text-muted hover:text-text transition-colors self-start"
        >
          <GitHubIcon className="w-3.5 h-3.5" />
          GitHub
        </a>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.resetHeading}</h3>
        <span className="text-[10px] text-muted max-w-md">{loc.resetHint}</span>
        <DangerConfirmButton
          label={loc.reset}
          confirmLabel={loc.resetConfirm}
          cancelLabel={loc.resetCancel}
          onConfirm={resetSettings}
        />
      </section>
    </div>
  );
}
