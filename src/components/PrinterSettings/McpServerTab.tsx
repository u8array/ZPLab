import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/16/solid";
import { useT } from "../../hooks/useT";
import { useMcpServer, type RunState } from "../../hooks/useMcpServer";
import { labelCls, inputCls, buttonCls } from "../ui/formStyles";

/** Local MCP loopback server controls. Only mounted when the build can spawn
 *  the sidecar (gated by TAB_GATES in the modal). */
export function McpServerTab() {
  const loc = useT().printerSettings.mcp;
  const { run, enabled, port, token, tokenLoaded, running, toggle, regenerate, setPort, copy, copied } =
    useMcpServer();

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">{loc.heading}</h3>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="accent-accent"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span className={labelCls}>{loc.enable}</span>
      </label>
      <span className="text-[10px] text-muted pl-6 max-w-md">{loc.hint}</span>

      <StatusLine run={run} loc={loc} />

      <div className="flex flex-col gap-2 max-w-md">
        <div className="w-32 flex flex-col gap-1">
          <label className={labelCls}>{loc.port}</label>
          <input
            type="number"
            min={1024}
            max={65535}
            value={port}
            disabled={running}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isNaN(next)) setPort(next);
            }}
            className={`${inputCls} disabled:opacity-50`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>{loc.token}</label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={token}
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              className={`${buttonCls} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-2`}
              disabled={running || !tokenLoaded}
              onClick={regenerate}
            >
              {loc.regenerate}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={copy}
          disabled={!token}
          className="self-start flex items-center gap-1.5 text-[10px] font-mono text-muted hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {copied ? (
            <><CheckIcon className="w-3.5 h-3.5" />{loc.copied}</>
          ) : (
            <><ClipboardDocumentIcon className="w-3.5 h-3.5" />{loc.copyConfig}</>
          )}
        </button>
      </div>
    </section>
  );
}

function StatusLine({ run, loc }: { run: RunState; loc: ReturnType<typeof useT>["printerSettings"]["mcp"] }) {
  if (run.kind === "error") {
    return <span className="text-[10px] font-mono text-error">{run.message}</span>;
  }
  const on = run.kind === "running" || run.kind === "starting";
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-mono text-muted">
      <span className={`w-2 h-2 rounded-full ${on ? "bg-green-500" : "bg-muted/50"}`} />
      {on ? loc.statusRunning : loc.statusStopped}
    </span>
  );
}
