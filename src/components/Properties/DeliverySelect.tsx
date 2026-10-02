import { RESOURCE_DELIVERIES, type ResourceDelivery } from '@zplab/core/lib/resourceDelivery';
import { useT } from '../../hooks/useT';
import { FieldLabel } from './ZplCmd';
import { Select } from '../ui/Select';

interface Props {
  value: ResourceDelivery;
  onChange: (next: ResourceDelivery) => void;
  /** The printer-side fallback differs: a missing font substitutes, a missing graphic or format prints nothing. */
  resource: 'font' | 'graphic' | 'format';
  /** Names the file in the accessible name, since a list shows one select per row. */
  subject: string;
  /** Why a way cannot be chosen right now, shown on the disabled option. */
  blocked?: Partial<Record<ResourceDelivery, string>>;
  /** A warning about the chosen way, shown under the hint. */
  issue?: string;
  /** Jumps to the printer tab that provisions the file, offered once the file is delivered at setup. */
  onOpenSetup?: { label: string; open: () => void };
  disabled?: boolean;
}

/** One control for every file the printer needs, so job, setup and printer cannot diverge across two widgets. */
export function DeliverySelect({ value, onChange, resource, subject, blocked, issue, onOpenSetup, disabled }: Props) {
  const t = useT();
  const hints: Record<ResourceDelivery, string> = resource === 'format'
    ? { job: t.delivery.formatJobHint, setup: t.delivery.formatSetupHint, printer: t.delivery.formatPrinterHint }
    : { job: t.delivery.jobHint, setup: t.delivery.setupHint, printer: resource === 'font' ? t.delivery.printerFontHint : t.delivery.printerGraphicHint };
  const warn = resource === 'format' && value === 'printer';
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{t.delivery.label}</FieldLabel>
      <Select<ResourceDelivery>
        value={value}
        onChange={(next) => {
          if (next !== value) onChange(next);
        }}
        aria-label={`${t.delivery.label}: ${subject}`}
        disabled={disabled}
        groups={[{ options: RESOURCE_DELIVERIES.map((way) => ({
          value: way,
          label: t.delivery[way],
          disabled: blocked?.[way] !== undefined,
          tooltip: blocked?.[way],
        })) }]}
      />
      <p className={`text-[10px] leading-snug ${warn ? 'text-warning' : 'text-muted'}`}>{hints[value]}</p>
      {issue && <p className="text-[10px] text-warning">{issue}</p>}
      {value === 'setup' && onOpenSetup && (
        <button type="button" className="self-start text-[10px] text-accent hover:underline" onClick={onOpenSetup.open}>
          {onOpenSetup.label}
        </button>
      )}
    </div>
  );
}
