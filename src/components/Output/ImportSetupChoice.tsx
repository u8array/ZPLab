import type { ImportFinding } from '@zplab/core/lib/importReport';
import type { SetupCommandChoice } from '@zplab/core/lib/zplImportService';
import { useT } from '../../hooks/useT';
import { formatTemplate } from '../../lib/formatTemplate';
import { FindingRow } from './ImportSummary';

interface Props {
  /** Routable setup commands plus (for awareness) device actions. */
  findings: ImportFinding[];
  /** The device actions a routed page loses, from commandsLostByRouting. */
  lost: readonly string[];
  /** False in append-mode: appended pages regenerate, so "keep" can't hold. */
  canKeep: boolean;
  onChoose: (choice: SetupCommandChoice) => void;
}

/** Pre-commit prompt for imported setup commands; preselects "setup script"
 *  (their channel), so they don't silently reconfigure the printer. */
export function ImportSetupChoice({ findings, lost, canKeep, onChoose }: Props) {
  const t = useT();
  const multiPage = findings.some((f) => f.pageIndex > 0);
  const lostCommands = lost.join(', ');

  return (
    <>
      <div className="flex flex-col gap-3 p-4 flex-1 min-h-0 overflow-y-auto">
        <p className="font-mono text-[10px] text-red-400 leading-relaxed">
          {t.app.importSetupTitle}
        </p>
        <div className="flex flex-col">
          {findings.map((f, i) => (
            <FindingRow key={`${f.pageIndex}-${f.command}-${i}`} finding={f} showPage={multiPage} />
          ))}
        </div>
        <p className="font-mono text-[10px] text-muted leading-relaxed">
          {t.app.importSetupBody}
        </p>
        {lostCommands && (
          <p role="status" className="font-mono text-[10px] text-amber-400 leading-relaxed">
            {formatTemplate(t.app.importSetupDropsFmt, { commands: lostCommands })}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
        <button
          onClick={() => onChoose('remove')}
          className="px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          {t.app.importSetupRemove}
        </button>
        {canKeep && (
          <button
            onClick={() => onChoose('keep')}
            className="px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            {t.app.importSetupKeep}
          </button>
        )}
        <button
          autoFocus
          onClick={() => onChoose('setupScript')}
          className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
        >
          {t.app.importSetupToSetup}
        </button>
      </div>
    </>
  );
}
