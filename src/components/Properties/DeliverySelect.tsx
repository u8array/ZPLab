import { RESOURCE_DELIVERIES, type ResourceDelivery } from '@zplab/core/lib/resourceDelivery';
import { useT } from '../../hooks/useT';
import { FieldLabel } from './ZplCmd';
import { Select } from '../ui/Select';

interface Props {
  value: ResourceDelivery;
  onChange: (next: ResourceDelivery) => void;
  /** The printer-side fallback differs: a missing font substitutes, a missing graphic prints nothing. */
  resource: 'font' | 'graphic';
  /** Names the file in the accessible name, since a list shows one select per row. */
  subject: string;
  /** Why a way cannot be chosen right now, shown on the disabled option. */
  blocked?: Partial<Record<ResourceDelivery, string>>;
  /** A warning about the chosen way, shown under the hint. */
  issue?: string;
  /** Jumps to the printer tab that provisions the file, offered once the file is delivered at setup. */
  onOpenSetup?: { label: string; open: () => void };
}

/** One control for every file the printer needs, so job, setup and printer cannot diverge across two widgets. */
export function DeliverySelect({ value, onChange, resource, subject, blocked, issue, onOpenSetup }: Props) {
  const t = useT();
  const hint = value === 'job' ? t.delivery.jobHint : value === 'setup' ? t.delivery.setupHint : resource === 'font' ? t.delivery.printerFontHint : t.delivery.printerGraphicHint;
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{t.delivery.label}</FieldLabel>
      <Select<ResourceDelivery>
        value={value}
        onChange={(next) => {
          if (next !== value) onChange(next);
        }}
        aria-label={`${t.delivery.label}: ${subject}`}
        groups={[{ options: RESOURCE_DELIVERIES.map((way) => ({
          value: way,
          label: t.delivery[way],
          disabled: blocked?.[way] !== undefined,
          tooltip: blocked?.[way],
        })) }]}
      />
      <p className="text-[10px] leading-snug text-muted">{hint}</p>
      {issue && <p className="text-[10px] text-warning">{issue}</p>}
      {value === 'setup' && onOpenSetup && (
        <button type="button" className="self-start text-[10px] text-accent hover:underline" onClick={onOpenSetup.open}>
          {onOpenSetup.label}
        </button>
      )}
    </div>
  );
}
