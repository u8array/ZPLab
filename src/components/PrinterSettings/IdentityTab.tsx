import { useId, useState } from "react";
import { useT } from "../../hooks/useT";
import { useLabelStore } from "../../store/labelStore";
import { inputCls, labelCls } from "../ui/formStyles";
import {
  CONFIG_UPDATE_VALUES,
  type ConfigUpdateAction,
  MODE_PROTECTION_VALUES,
  type ModeProtection,
  PRINTER_NAME_MAX_LEN,
  PRINTER_PASSWORD_REGEX,
  toggleModeProtection,
} from "@zplab/core/types/PrinterProfile";
import {
  SafeStringInput,
  ZplCheckbox,
  ZplCommandLabel,
  ZplEnumCustomSelect,
  ZplEnumSegmented,
  ZplField,
  ZplSubField,
} from "./zplFieldPrimitives";

const MODE_PROTECTION_LABEL_KEYS = {
  D: "modeProtectDarkness",
  P: "modeProtectPosition",
  C: "modeProtectCalibration",
  S: "modeProtectSaves",
  W: "modeProtectPause",
  F: "modeProtectFeed",
  X: "modeProtectCancel",
  M: "modeProtectMenu",
} as const satisfies Record<ModeProtection, keyof LocIdentity>;

type LocIdentity = ReturnType<typeof useT>["printerSettings"]["identity"];

/** Explicit value → locale-key map; `satisfies` forces every
 *  ConfigUpdateAction to have an entry and rejects typo keys at
 *  compile time. Matches the CLOCK_FORMAT_LABEL_KEYS pattern. */
const CONFIG_UPDATE_LABEL_KEYS = {
  S: 'configurationUpdateOptionS',
  R: 'configurationUpdateOptionR',
  N: 'configurationUpdateOptionN',
  F: 'configurationUpdateOptionF',
} as const satisfies Record<ConfigUpdateAction, keyof LocIdentity>;

/** Tab 5 of the Printer Settings Modal: printer identity + EEPROM
 *  commit setup. Emits ^KN (name + description), ^KP (4-digit panel
 *  password) and ^JU (configuration update action) on the Setup-
 *  Script channel. ^SL lives in Tab 3 Clock & Time per its semantic
 *  home. */
export function IdentityTab() {
  const t = useT();
  const profile = useLabelStore((s) => s.printerProfile);
  const patchPrinterProfile = useLabelStore((s) => s.patchPrinterProfile);
  const loc = t.printerSettings.identity;
  const nameId = useId();
  const passwordId = useId();
  // Progressive-commit draft: store only accepts a complete 4-digit
  // value, but the user has to type intermediate states. SafeStringInput
  // is fully controlled and would clobber the partial draft, so the
  // ^KP input stays hand-rolled. Adjust-state-during-render reseeds on
  // external changes (import, reset).
  const storedPassword = profile.setPassword ?? "";
  const [passwordDraft, setPasswordDraft] = useState(storedPassword);
  const [lastStoredPassword, setLastStoredPassword] = useState(storedPassword);
  if (lastStoredPassword !== storedPassword) {
    setLastStoredPassword(storedPassword);
    setPasswordDraft(storedPassword);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Both inputs fold into one ^KN emit. The tag sits on the
          parent ZplField only; the description uses ZplSubField
          to share the tag instead of duplicating it (same pattern
          as ^PR triple in PrintQualityTab and ^MF pair in
          MediaFeedTab). */}
      <ZplField>
        <ZplCommandLabel text={loc.printerName} command="^KN" htmlFor={nameId} />
        <SafeStringInput
          id={nameId}
          maxLength={PRINTER_NAME_MAX_LEN}
          value={profile.printerName ?? ""}
          onChange={(v) => patchPrinterProfile({ printerName: v || undefined })}
        />
        <span className={`${labelCls} normal-case tracking-normal text-muted/70`}>
          {loc.printerNameHint}
        </span>

        <ZplSubField label={loc.printerDescription}>
          {(id) => (
            <SafeStringInput
              id={id}
              value={profile.printerDescription ?? ""}
              onChange={(v) => patchPrinterProfile({ printerDescription: v || undefined })}
            />
          )}
        </ZplSubField>
      </ZplField>

      <ZplField>
        <ZplCommandLabel text={loc.setPassword} command="^KP" htmlFor={passwordId} />
        <input
          id={passwordId}
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          className={inputCls}
          value={passwordDraft}
          onChange={(e) => {
            const raw = e.target.value;
            if (!/^\d{0,4}$/.test(raw)) return;
            setPasswordDraft(raw);
            if (raw === "") {
              patchPrinterProfile({ setPassword: undefined });
            } else if (PRINTER_PASSWORD_REGEX.test(raw)) {
              patchPrinterProfile({ setPassword: raw });
            }
          }}
          onBlur={() => {
            // Snap drafts back when they diverge from the store (incomplete
            // typing, or patch silently rejected by the lock-when-preview guard).
            if (passwordDraft !== lastStoredPassword) {
              setPasswordDraft(lastStoredPassword);
            }
          }}
        />
        <span className={`${labelCls} normal-case tracking-normal text-muted/70`}>
          {loc.setPasswordHint}
        </span>
      </ZplField>

      {/* Tri-state: unset leaves the printer alone; Custom is the absolute
          set (empty = visible ^MPE enable-all), avoiding a checkbox group's
          invisible []-vs-undefined ambiguity. */}
      <ZplEnumSegmented
        label={loc.modeProtection}
        command="^MP"
        values={['custom'] as const}
        value={profile.modeProtection !== undefined ? 'custom' : undefined}
        onChange={(v) =>
          patchPrinterProfile(
            v === 'custom'
              ? { modeProtection: [], modeProtectionExplicit: true }
              : { modeProtection: undefined, modeProtectionExplicit: undefined },
          )
        }
        defaultLabel={t.printerSettings.defaultOption}
        optionLabel={() => loc.modeProtectCustom}
        hint={profile.modeProtection?.length === 0 ? loc.modeProtectCustomHint : undefined}
      />
      {profile.modeProtection !== undefined && (
        <ZplField>
          <div className="flex flex-col gap-1.5">
            {MODE_PROTECTION_VALUES.map((m) => (
              <ZplCheckbox
                key={m}
                command={`^MP${m}`}
                text={loc[MODE_PROTECTION_LABEL_KEYS[m]]}
                checked={(profile.modeProtection ?? []).includes(m)}
                onChange={(on) => {
                  patchPrinterProfile({
                    modeProtection: toggleModeProtection(profile.modeProtection, m, on),
                    modeProtectionExplicit: true,
                  });
                }}
              />
            ))}
          </div>
        </ZplField>
      )}

      <ZplEnumCustomSelect
        label={loc.configurationUpdate}
        command="^JU"
        values={CONFIG_UPDATE_VALUES}
        value={profile.configurationUpdate}
        onChange={(configurationUpdate) => patchPrinterProfile({ configurationUpdate })}
        defaultLabel={loc.configurationUpdateUnset}
        optionLabel={(v) => loc[CONFIG_UPDATE_LABEL_KEYS[v]]}
      />
    </div>
  );
}
