import { CheckboxRow } from './CheckboxRow';
import { useT } from '../../hooks/useT';

/** The "text above the bars" toggle every HRI-capable symbology shows. */
export function HriAboveRow({
  checked,
  onChange,
  cmd,
}: {
  checked: boolean | undefined;
  onChange: (printInterpretationAbove: boolean) => void;
  cmd: string;
}) {
  const t = useT();
  return (
    <CheckboxRow
      checked={checked ?? false}
      onChange={onChange}
      label={t.registry.text.hriAbove}
      cmd={cmd}
    />
  );
}
