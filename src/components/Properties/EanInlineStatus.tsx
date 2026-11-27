import { useT } from '../../hooks/useT';
import { hasTemplateMarkers } from '@zplab/core/lib/fnTemplate';
import { validateEanUpc, type EanUpcType, type EanUpcStatus } from '@zplab/core/lib/eanUpcValidate';
import { eanPrefixKey } from '../../lib/eanPrefix';
import {
  formatEan13Hri,
  formatEan8Hri,
  formatUpcaHri,
  formatUpceHri,
} from '@zplab/core/registry/hriFormatters';

// The exact printed HRI per type, so the full-code display can never drift from
// the renderer (incl. UPC-E's number-system prefix). Check digit = last char.
const FULL_HRI: Record<EanUpcType, (content: string) => string> = {
  ean13: formatEan13Hri,
  ean8: formatEan8Hri,
  upca: formatUpcaHri,
  upce: formatUpceHri,
};

const STATUS_COLOR: Record<EanUpcStatus, string> = {
  empty: 'text-muted',
  short: 'text-info',
  complete: 'text-ok',
  badCheck: 'text-error',
  tooLong: 'text-error',
};

/** Inline length counter + computed check digit (+ GS1 prefix hint for EAN-13)
 *  under the content field. Shows only what the renderer prints: content is the
 *  N data digits, the check digit is always computed downstream. */
export function EanInlineStatus({ type, content }: { type: EanUpcType; content: string }) {
  const t = useT();
  const tc = t.eanInline;
  // Templated content (variable or clock markers) resolves at print time; its
  // final digits are unknown, so length/check-digit validation does not apply.
  if (hasTemplateMarkers(content)) return null;
  const v = validateEanUpc(type, content);
  // Prefix hint is EAN-13 only and shows as soon as the first 3 digits exist.
  const prefix = type === 'ean13' ? eanPrefixKey(v.digits) : null;
  const color = STATUS_COLOR[v.status];
  const message = ((): string => {
    switch (v.status) {
      case 'empty': return tc.enterDigitsFmt.replaceAll('{n}', String(v.dataLen));
      case 'short': return tc.remainingFmt.replaceAll('{k}', String(v.remaining));
      case 'complete': return tc.checkAppendedFmt.replaceAll('{d}', v.checkDigit ?? '');
      case 'badCheck': return tc.badCheckFmt.replaceAll('{x}', v.expected ?? '').replaceAll('{y}', v.got ?? '');
      case 'tooLong': return tc.tooLongFmt.replaceAll('{n}', String(v.dataLen));
    }
  })();
  const hri = v.status === 'complete' ? FULL_HRI[type](content) : '';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
        <span className="text-muted">{tc.dataLabel}</span>
        <span className={color}>{v.digits.length}/{v.dataLen}</span>
      </div>
      <span className={`text-[10px] ${color}`} role="status" aria-live="polite">{message}</span>
      {v.status === 'complete' && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted">{tc.fullCodeLabel}</span>
          <code className="font-mono text-xs bg-surface-2 rounded px-2 py-1 text-text break-all">
            {hri.slice(0, -1)}
            <span className="text-ok font-semibold">{hri.slice(-1)}</span>
          </code>
        </div>
      )}
      {prefix && (
        <span className="text-[10px] text-muted">
          {tc.prefixLabel} {v.digits.slice(0, 3)}: {tc.country[prefix]}
        </span>
      )}
    </div>
  );
}
