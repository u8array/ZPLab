import { hostCommandParts } from "./hostCommands";
import { parseHostDirectories, type HostDirectory } from "./hostDirectory";
import {
  parseHostIdentification,
  parseHostMemory,
  parseHostQueryStatus,
  parseHostStatus,
  type HostMemory,
  type HostQueryStatus,
  type HostStatus,
  type PrinterIdentity,
} from "./hostStatus";

/** What the parsers read from a reply, under the command that was asked. */
export interface HostReplyParts {
  identity?: PrinterIdentity;
  flags?: HostQueryStatus;
  memory?: HostMemory;
  status?: HostStatus;
  directories?: HostDirectory[];
}

function present<K extends keyof HostReplyParts>(key: K, value: HostReplyParts[K]): HostReplyParts {
  return value === undefined ? {} : { [key]: value };
}

const nonEmpty = (directories: HostDirectory[]): HostDirectory[] | undefined => (directories.length > 0 ? directories : undefined);

const HOST_READINGS: readonly { id: string; read: (body: string) => HostReplyParts }[] = [
  { id: "~HI", read: (body) => present("identity", parseHostIdentification(body)) },
  // Only the ES flags of ~HQ have a parser.
  { id: "~HQ", read: (body) => present("flags", parseHostQueryStatus(body)) },
  { id: "~HM", read: (body) => present("memory", parseHostMemory(body)) },
  { id: "~HS", read: (body) => present("status", parseHostStatus(body)) },
  { id: "^HW", read: (body) => present("directories", nonEmpty(parseHostDirectories(body))) },
];

/** A reading matches an asked command by its id, since ~HQ names its subject behind it. A parser that finds nothing leaves its field out. */
export function parseHostReplies(body: string, asked: readonly string[]): HostReplyParts {
  const ids = asked.map((command) => hostCommandParts(command).id);
  return HOST_READINGS.filter((r) => ids.includes(r.id)).reduce<HostReplyParts>((parts, r) => ({ ...parts, ...r.read(body) }), {});
}
