import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CircleStackIcon,
  DocumentIcon,
  TableCellsIcon,
  XMarkIcon,
} from '@heroicons/react/16/solid';
import { useLabelStore } from '../../store/labelStore';
import { useT } from '../../hooks/useT';
import { useCsvImportActions } from '../../hooks/useCsvImportActions';
import { useExcelImportActions } from '../../hooks/useExcelImportActions';
import { useSqliteConnectActions } from '../../hooks/useSqliteConnectActions';
import { useDbConnectActions } from '../../hooks/useDbConnectActions';
import { isCurrentDataContext, settleDatasetReplace } from '../../store/datasetActions';
import { isDesktopShell } from '../../lib/platform';
import { DialogShell } from '../ui/DialogShell';
import { CsvImportConfirmDialog } from './CsvImportConfirmDialog';
import { SourcePickModal } from './SourcePickModal';
import { ServerDbStep } from './ServerDbStep';
import { useWizardArm } from './useWizardArm';
import { MappingEditor } from './MappingEditor';
import { useMappingDraft } from './useMappingDraft';

/** Guided connect-data flow: pick a source, load it, map columns, done. A thin
 *  orchestrator over the existing import hooks and the mapping core; every step
 *  it drives stays reachable without it (DataSourcesTab, the import actions). */
export function ConnectDataWizard() {
  const t = useT();
  const tc = t.connectData;
  const closeConnectWizard = useLabelStore((s) => s.closeConnectWizard);
  const { loaded, ownLoadToken, markLoaded, reset, loadArmed } = useWizardArm();
  const {
    csvInputRef,
    handleCsvImport,
    openCsvPicker,
    pendingImport,
    confirmPendingImport,
    cancelPendingImport,
  } = useCsvImportActions(markLoaded);
  const { openExcelPicker, pendingExcel, loadSheet, cancelExcelImport } = useExcelImportActions();
  const { openSqlitePicker, pendingSqlite, loadTable, cancelSqliteImport } = useSqliteConnectActions();
  const { loadFromDb } = useDbConnectActions();
  const [serverDriver, setServerDriver] = useState<'postgres' | 'mysql' | null>(null);
  const [done, setDone] = useState(false);
  // The wizard is a transaction over the data context: only Finish commits,
  // any abort restores this snapshot, guarded so a foreign load or document
  // swap that became the latest mutation is never clobbered.
  const [snapshot] = useState(() => {
    const s = useLabelStore.getState();
    return { dataset: s.dataset, dataSourceRef: s.dataSourceRef, columnMapping: s.columnMapping };
  });
  // Mirrored for the unmount cleanup, which sees only the mount closure.
  const abortRef = useRef({ ownLoadToken, done });
  useEffect(() => {
    abortRef.current = { ownLoadToken, done };
  }, [ownLoadToken, done]);
  const restoreOnAbort = () => {
    const { ownLoadToken: token } = abortRef.current;
    if (token !== null && isCurrentDataContext(token)) {
      useLabelStore.getState().restoreDataSnapshot(snapshot);
    }
    reset();
  };
  useEffect(
    () => () => {
      // Closing dismisses the whole flow: drop a parked replace confirm, undo
      // an uncommitted load, and supersede any fetch still in flight so it can
      // neither commit a dataset nor persist a profile afterwards.
      settleDatasetReplace(false);
      if (!abortRef.current.done) restoreOnAbort();
      useLabelStore.getState().invalidateDatasetFetches();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
    [],
  );
  const step = done ? 'done' : loaded ? 'mapping' : serverDriver ? 'server' : 'source';

  const backToSource = () => {
    restoreOnAbort();
    setServerDriver(null);
  };
  // Leaving the server step must also supersede a load still in flight, or a
  // late success would advance and persist a flow the user already left.
  const backFromServer = () => {
    useLabelStore.getState().invalidateDatasetFetches();
    setServerDriver(null);
  };

  return (
    <DialogShell
      onClose={closeConnectWizard}
      labelledBy="connect-data-title"
      boxClassName="bg-surface border border-border rounded-lg w-[34rem] flex flex-col shadow-2xl max-h-[85vh]"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span
          id="connect-data-title"
          className="font-mono text-xs text-muted uppercase tracking-widest"
        >
          {tc.title}
        </span>
        <button
          onClick={closeConnectWizard}
          aria-label={t.variables.cancel}
          className="p-0.5 rounded text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* This instance's own picker input; openCsvPicker clicks it on the web. */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleCsvImport}
      />

      {step === 'source' && (
        <SourceStep
          onPickCsv={openCsvPicker}
          onPickExcel={openExcelPicker}
          onPickSqlite={openSqlitePicker}
          onPickServer={setServerDriver}
        />
      )}
      {step === 'server' && serverDriver && (
        <ServerDbStep
          driver={serverDriver}
          onBack={backFromServer}
          onLoad={(profile, table) => loadArmed(() => loadFromDb(profile, table))}
        />
      )}
      {step === 'mapping' && (
        <WizardMappingStep onBack={backToSource} onDone={() => setDone(true)} />
      )}
      {step === 'done' && <DoneStep onClose={closeConnectWizard} />}

      {pendingImport && isCurrentDataContext(pendingImport.token) && (
        <CsvImportConfirmDialog
          pending={pendingImport}
          onConfirm={confirmPendingImport}
          onCancel={cancelPendingImport}
        />
      )}

      {pendingExcel && isCurrentDataContext(pendingExcel.token) && (
        <SourcePickModal
          key={pendingExcel.path}
          titleText={pendingExcel.filename}
          titleAttr={pendingExcel.filename}
          label={t.variables.excelSheetLabel}
          options={pendingExcel.sheets}
          onLoad={(sheet) => loadArmed(() => loadSheet(sheet))}
          onCancel={cancelExcelImport}
        />
      )}

      {pendingSqlite && isCurrentDataContext(pendingSqlite.token) && (
        <SourcePickModal
          key={pendingSqlite.profile.id}
          titleText={pendingSqlite.profile.name}
          titleAttr={pendingSqlite.profile.path}
          label={t.variables.dbTableLabel}
          options={pendingSqlite.tables}
          onLoad={(tbl) => loadArmed(() => loadTable(tbl))}
          onCancel={cancelSqliteImport}
        />
      )}
    </DialogShell>
  );
}

function SourceStep({
  onPickCsv,
  onPickExcel,
  onPickSqlite,
  onPickServer,
}: {
  onPickCsv: () => void;
  onPickExcel: () => void;
  onPickSqlite: () => void;
  onPickServer: (driver: 'postgres' | 'mysql') => void;
}) {
  const tc = useT().connectData;
  return (
    <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto">
      <p className="font-mono text-[10px] text-muted leading-relaxed">{tc.chooseSource}</p>
      <div className="grid grid-cols-2 gap-2">
        <SourceCard icon={<TableCellsIcon className="w-4 h-4" />} label={tc.csv} onClick={onPickCsv} />
        <SourceCard
          icon={<DocumentIcon className="w-4 h-4" />}
          label={tc.excel}
          onClick={isDesktopShell ? onPickExcel : undefined}
        />
        <SourceCard
          icon={<CircleStackIcon className="w-4 h-4" />}
          label={tc.sqlite}
          onClick={isDesktopShell ? onPickSqlite : undefined}
        />
        <SourceCard
          icon={<CircleStackIcon className="w-4 h-4" />}
          label={tc.mysql}
          onClick={isDesktopShell ? () => onPickServer('mysql') : undefined}
        />
        <SourceCard
          icon={<CircleStackIcon className="w-4 h-4" />}
          label={tc.postgres}
          onClick={isDesktopShell ? () => onPickServer('postgres') : undefined}
        />
      </div>
    </div>
  );
}

/** A card without a handler renders disabled with the desktop-only note (every
 *  source is implemented; only the web shell lacks the Rust side). */
function SourceCard({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const tc = useT().connectData;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex items-center gap-2 px-3 py-3 rounded border border-border text-xs font-mono text-text hover:border-accent hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent"
    >
      <span className="text-accent">{icon}</span>
      <span className="flex flex-col items-start">
        {label}
        {!onClick && <span className="text-[9px] text-muted italic">{tc.desktopOnly}</span>}
      </span>
    </button>
  );
}

/** Mounted only once a dataset is loaded, so useMappingDraft clones the draft
 *  from that dataset (its state seeds on mount). */
function WizardMappingStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { connectData: tc, variables: tv } = useT();
  const draft = useMappingDraft();

  const finish = () => {
    draft.apply();
    onDone();
  };

  return (
    <>
      <div className="px-4 py-4 overflow-y-auto">
        <MappingEditor draft={draft} />
      </div>
      <div className="flex justify-between items-center gap-2 px-4 py-3 border-t border-border shrink-0">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono text-muted hover:text-text hover:bg-surface-2 transition-colors"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          {tv.cancel}
        </button>
        <button
          onClick={finish}
          disabled={!draft.canApply}
          className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {tc.finish}
        </button>
      </div>
    </>
  );
}

function DoneStep({ onClose }: { onClose: () => void }) {
  const tc = useT().connectData;
  return (
    <>
      <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <CheckCircleIcon className="w-8 h-8 text-accent" />
        <p className="font-mono text-xs text-text">{tc.doneTitle}</p>
        <p className="font-mono text-[10px] text-muted leading-relaxed max-w-sm">{tc.doneBody}</p>
      </div>
      <div className="flex justify-end px-4 py-3 border-t border-border shrink-0">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
        >
          {tc.finish}
        </button>
      </div>
    </>
  );
}
