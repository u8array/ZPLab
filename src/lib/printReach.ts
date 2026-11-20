import { isDesktopShell } from "./platform";
import type { PrintReach } from "./printTarget";

const configured: unknown = import.meta.env.VITE_SERVER_API_URL;

/** Only the build the server serves sets it. */
export const serverApiBase: string | undefined = typeof configured === "string" && configured.trim() ? configured.trim().replace(/\/+$/, "") : undefined;

/** The server answers its own origin only, so the desktop shell does not reach it. */
export const printReach: PrintReach = { desktop: isDesktopShell, server: !isDesktopShell && serverApiBase !== undefined };
