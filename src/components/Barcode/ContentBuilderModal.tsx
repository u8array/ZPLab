import { useState } from "react";
import { BarcodeContentModalShell } from "./BarcodeContentModalShell";
import { useT } from "../../hooks/useT";
import { Select } from "../ui/Select";
import { useLabelStore, useCurrentObjects, getCurrentObjects } from "../../store/labelStore";
import { hasTemplateMarkers, resolvedContentLength } from "@zplab/core/lib/fnTemplate";
import { usePreviewBinding } from "../../store/usePreviewBinding";
import { getObjectStringContent } from "@zplab/core/lib/variableBinding";
import { MarkerTextField } from "../Properties/MarkerTextField";
import { findObjectById } from "@zplab/core/types/Group";
import { objectResolvesCtrl } from "@zplab/core/registry";
import { encodeContent, parseContent, recommendedEc, isContentComplete, isContactDate, markerStandIn, typedContentMarkerFindings, CONTENT_TYPES, MECARD_FIELDS, VCARD_FIELDS, type ContentType, type ContentFields } from "@zplab/core/lib/typedContent";

type FieldKind = "text" | "textarea" | "checkbox" | "auth";


interface FieldDef {
  key: string;
  labelKey: string;
  kind: FieldKind;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Per-type form fields; `key` matches typedContent field keys, `labelKey` a
// t.contentBuilder.* string. Order = display order. Every value field accepts
// «marker»s: the encoders escape only literal spans, so tokens stay atomic.
const FORM_FIELDS: Record<ContentType, FieldDef[]> = {
  url: [{ key: "url", labelKey: "fUrl", kind: "text" }],
  text: [{ key: "text", labelKey: "fText", kind: "textarea" }],
  wifi: [
    { key: "ssid", labelKey: "fSsid", kind: "text" },
    // Prints in the code and shows in the panel, so nothing to mask.
    { key: "password", labelKey: "fPassword", kind: "text" },
    { key: "auth", labelKey: "fAuth", kind: "auth" },
    { key: "hidden", labelKey: "fHidden", kind: "checkbox" },
  ],
  // Derived from the encoder's lists, as the escaper table is, so a field cannot lack a rule.
  vcard: VCARD_FIELDS.map((key) => ({ key, labelKey: `f${cap(key)}`, kind: key === "note" ? "textarea" : "text" })),
  mecard: MECARD_FIELDS.map((key) => ({ key, labelKey: `f${cap(key)}`, kind: key === "note" ? "textarea" : "text" })),
  email: [
    { key: "to", labelKey: "fTo", kind: "text" },
    { key: "subject", labelKey: "fSubject", kind: "text" },
    { key: "body", labelKey: "fBody", kind: "textarea" },
  ],
  tel: [{ key: "number", labelKey: "fNumber", kind: "text" }],
  sms: [
    { key: "number", labelKey: "fNumber", kind: "text" },
    { key: "message", labelKey: "fMessage", kind: "textarea" },
  ],
  geo: [
    { key: "lat", labelKey: "fLat", kind: "text" },
    { key: "lng", labelKey: "fLng", kind: "text" },
  ],
};

export function ContentBuilderModal() {
  const objectId = useLabelStore((s) => s.contentBuilderObjectId);
  if (!objectId) return null;
  // Keyed remount per target so the draft re-seeds from that object.
  return <ContentBuilder key={objectId} objectId={objectId} />;
}

function ContentBuilder({ objectId }: { objectId: string }) {
  const t = useT();
  const tc = t.contentBuilder;
  const L = (k: string): string => (t.contentBuilder as Record<string, string>)[k] ?? k;
  const closeContentBuilder = useLabelStore((s) => s.closeContentBuilder);
  const { variables, resolveDefaults } = usePreviewBinding();
  const updateObject = useLabelStore((s) => s.updateObject);

  // Parse the object's current content once (lazy) to seed the draft.
  const [seed] = useState(() => {
    const obj = findObjectById(getCurrentObjects(), objectId);
    return parseContent((obj && getObjectStringContent(obj)) || "");
  });
  const [type, setType] = useState<ContentType>(seed.type);
  const [byType, setByType] = useState<Record<string, ContentFields>>({ [seed.type]: seed.fields });

  const fields = byType[type] ?? {};
  const setField = (key: string, value: string) =>
    setByType((prev) => ({ ...prev, [type]: { ...(prev[type] ?? {}), [key]: value } }));

  const content = encodeContent(type, fields);
  // Validate fields as their preview substitution (GS1-builder precedent): a
  // marker is checked as the text it prints. A marker resolving to "" is
  // runtime-valued (CSV/prompt fills it later), so it stands in as a value
  // passing every per-type check, instead of blocking Apply on an empty default.
  const validationFields = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => {
      const resolved = resolveDefaults(v);
      return [k, resolved === "" && hasTemplateMarkers(v) ? markerStandIn(k) : resolved];
    }),
  );
  // The one field whose shape a scanner silently discards, so the gate says why it holds.
  const badDate = !isContactDate((validationFields.birthday ?? "").trim());
  // A marker's print-time value is inserted as-is (no escaping); block Apply
  // when any substituted value (variable default or a bound CSV cell, all
  // rows) carries chars this field's encoding can't take. Authoring-time gate
  // only: later CSV re-imports aren't re-checked here.
  const dataset = useLabelStore((s) => s.dataset);
  const columnMapping = useLabelStore((s) => s.columnMapping);
  const markerErrors = typedContentMarkerFindings(type, fields, variables, dataset, columnMapping);
  const valid = isContentComplete(type, validationFields) && Object.keys(markerErrors).length === 0;
  const ec = recommendedEc(resolveDefaults(content));
  // EC recommendation is QR-only; DataMatrix uses fixed ECC200.
  const objects = useCurrentObjects();
  const target = findObjectById(objects, objectId);
  const isQr = target?.type === "qrcode";
  const currentEc =
    target && "props" in target ? (target.props as { errorCorrection?: string }).errorCorrection : undefined;

  const apply = () => {
    updateObject(objectId, { props: { content } });
    closeContentBuilder();
  };
  const applyEc = () => updateObject(objectId, { props: { errorCorrection: ec } });

  return (
    <BarcodeContentModalShell
      title={tc.title}
      subtitle={tc.subtitle}
      onClose={closeContentBuilder}
      onApply={apply}
      applyDisabled={!valid}
      applyLabel={tc.apply}
      cancelLabel={tc.cancel}
      closeLabel={tc.close}
    >
      <div className="flex flex-wrap gap-1.5">
        {CONTENT_TYPES.map((ct) => (
          <button
            key={ct}
            type="button"
            onClick={() => setType(ct)}
            aria-pressed={ct === type}
            className={`px-2 py-1 rounded text-xs border transition-colors ${
              ct === type ? "border-accent bg-accent-dim text-accent" : "border-border bg-surface-2 hover:bg-border text-text"
            }`}
          >
            {L(`type${cap(ct)}`)}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        {FORM_FIELDS[type].map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            {f.kind === "checkbox" ? (
              <label className="flex items-center gap-2 cursor-pointer text-xs text-text">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={fields[f.key] === "true"}
                  onChange={(e) => setField(f.key, e.target.checked ? "true" : "")}
                />
                {L(f.labelKey)}
              </label>
            ) : (
              <>
                {/* The chip editor is a contenteditable div (not labelable), so
                    it gets an aria-label; htmlFor only works for the real
                    control, the auth select. */}
                {f.kind === "auth" ? (
                  <label className="text-[10px] text-muted" htmlFor={`content-${f.key}`}>{L(f.labelKey)}</label>
                ) : (
                  <span className="text-[10px] text-muted">{L(f.labelKey)}</span>
                )}
                {f.kind === "auth" ? (
                  <Select<string>
                    id={`content-${f.key}`}
                    value={fields[f.key] || "WPA"}
                    onChange={(value) => setField(f.key, value)}
                    groups={[
                      {
                        options: [
                          { value: "WPA", label: "WPA/WPA2/WPA3" },
                          { value: "WEP", label: "WEP" },
                          { value: "nopass", label: tc.fAuthOpen },
                        ],
                      },
                    ]}
                  />
                ) : (
                  <MarkerTextField
                    value={fields[f.key] ?? ""}
                    onChange={(next) => setField(f.key, next)}
                    multiline={f.kind === "textarea"}
                    ariaLabel={L(f.labelKey)}
                    hasError={markerErrors[f.key] !== undefined || (f.key === "birthday" && badDate)}
                  />
                )}
                {markerErrors[f.key] !== undefined && (
                  <span className="text-[10px] text-error">
                    {tc.errMarkerUnsafeChars.replace("{chars}", markerErrors[f.key] ?? "")}
                  </span>
                )}
                {f.key === "birthday" && badDate && <span className="text-[10px] text-error">{tc.errBirthday}</span>}
              </>
            )}
          </div>
        ))}
      </section>

      {valid && (
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted">{tc.preview}</span>
            <span className="text-[10px] text-muted">{tc.charsFmt.replace("{n}", String(resolvedContentLength(content, variables, target ? objectResolvesCtrl(target) : false)))}</span>
          </div>
          {/* Print preview: markers resolved in the assembled payload,
              matching the GS1 modal's semantics. */}
          <code className="text-xs font-mono text-text break-all whitespace-pre-wrap bg-surface-2 rounded px-2 py-1">
            {resolveDefaults(content)}
          </code>
          {isQr && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted">{tc.ecHintFmt.replace("{ec}", ec)}</span>
              {currentEc !== ec && (
                <button type="button" onClick={applyEc} className="text-[10px] text-accent hover:underline">
                  {tc.ecApply.replace("{ec}", ec)}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </BarcodeContentModalShell>
  );
}
