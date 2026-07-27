import { inputCls } from '../Properties/styles';
import { Select } from '../ui/Select';
import { useT } from '../../hooks/useT';
import type { DbSslMode } from '../../lib/db';

export interface NetworkDbFieldValues {
  host: string;
  port?: number;
  database: string;
  user: string;
  sslMode: DbSslMode;
}

interface Props {
  driver: 'postgres' | 'mysql';
  value: NetworkDbFieldValues;
  onChange: (patch: Partial<NetworkDbFieldValues>) => void;
  /** Consumer-specific password field, rendered between user and SSL (the
   *  settings tab commits on blur, the wizard holds a draft). */
  children?: React.ReactNode;
}

const fieldLabel = 'text-[10px] text-muted uppercase tracking-wider';

/** The network-DB endpoint form shared by the settings tab and the wizard, so
 *  fields and validation cannot drift between the two. */
export function NetworkDbFields({ driver, value, onChange, children }: Props) {
  const tv = useT().variables;
  return (
    <>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <label className={fieldLabel}>{tv.dbHostLabel}</label>
          <input
            className={inputCls}
            value={value.host}
            onChange={(e) => onChange({ host: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1 w-20 shrink-0">
          <label className={fieldLabel}>{tv.dbPortLabel}</label>
          <input
            type="number"
            className={inputCls}
            placeholder={driver === 'postgres' ? '5432' : '3306'}
            value={value.port ?? ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              // Rust deserializes into u16; clamp instead of an opaque serde
              // error at fetch time.
              onChange({ port: Number.isNaN(n) ? undefined : Math.min(65535, Math.max(1, n)) });
            }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className={fieldLabel}>{tv.dbDatabaseLabel}</label>
        <input
          className={inputCls}
          value={value.database}
          onChange={(e) => onChange({ database: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={fieldLabel}>{tv.dbUserLabel}</label>
        <input
          className={inputCls}
          value={value.user}
          onChange={(e) => onChange({ user: e.target.value })}
        />
      </div>

      {children}

      <div className="flex flex-col gap-1">
        <label className={fieldLabel}>{tv.dbSslLabel}</label>
        <Select<DbSslMode>
          value={value.sslMode}
          onChange={(sslMode) => onChange({ sslMode })}
          groups={[
            {
              options: (['prefer', 'require', 'verify-full', 'disable'] as const).map((m) => ({
                value: m,
                label: m,
              })),
            },
          ]}
        />
      </div>
    </>
  );
}
