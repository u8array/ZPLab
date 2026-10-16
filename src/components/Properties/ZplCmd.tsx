import type { ReactNode } from 'react';
import { useLabelStore } from '../../store/labelStore';
import { labelCls, zplCommandTagCls } from '../ui/formStyles';
import { Tooltip } from '../ui/Tooltip';
import { InformationCircleIcon } from '@heroicons/react/16/solid';

/**
 * Read-only ZPL command tag for a properties field (e.g. `^A`). Renders only
 * when the power-user `showZplCommands` preference is on. The mapping is a
 * static field→command reference (what this field emits), not a live
 * "currently in output" signal, so it is never gated on the field's own
 * enabled/disabled state.
 */
export function ZplCmd({ cmd }: { cmd?: string }) {
  const show = useLabelStore((s) => s.showZplCommands);
  if (!show || !cmd) return null;
  return <span className={zplCommandTagCls}>{cmd}</span>;
}

/** Field label row: the label, an optional hint icon beside it, the command tag right. */
export function FieldLabel({
  children,
  cmd,
  htmlFor,
  hint,
}: {
  children: ReactNode;
  cmd?: string;
  htmlFor?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="flex items-center gap-2">
        <label htmlFor={htmlFor} className={labelCls}>
          {children}
        </label>
        {hint && (
          <Tooltip content={hint}>
            <InformationCircleIcon className="w-3 h-3 text-muted/60 cursor-help shrink-0" />
          </Tooltip>
        )}
      </span>
      <ZplCmd cmd={cmd} />
    </div>
  );
}
