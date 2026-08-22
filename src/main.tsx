import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted UI fonts (bundled by Vite) so the app needs no Google Fonts CDN
// and runs fully offline. Weights match the former CDN request (400/500/600).
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './index.css'
import App from './App.tsx'
import { useLabelStore } from './store/labelStore'
import { mcpServerStatus } from './lib/mcpServer'
import { initMcpLifecycle } from './lib/mcpLifecycle'
import { initFootprintMeasurer } from './lib/footprintMeasurer'

initFootprintMeasurer();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
const root = createRoot(rootEl);

/** Cap on how long the first render waits for the active locale chunk. */
const LOCALE_BOOT_WAIT_MS = 250;

// Give the active locale chunk a brief head start so a persisted or
// browser-detected non-en language normally paints without an English
// flash, but never white-screen on a slow or stalled fetch: past the cap
// the app renders with en and the dictionary swaps in when it arrives
// (applyLocale keeps running and never rejects).
async function bootstrap() {
  const {
    locale,
    applyLocale,
    hydrateLabelaryApiKey,
    migrateLabelaryKey,
  } = useLabelStore.getState();
  // Migrate a legacy unbound key into the host-bound rust-only credential (so
  // an existing key doesn't stay IPC-readable), then load it. Startup, not
  // settings-open, so a user who never visits Preview settings is still
  // covered. Fire-and-forget; a keychain failure must not delay paint or throw.
  void migrateLabelaryKey().catch(() => undefined).then(hydrateLabelaryApiKey);
  // Stamp the build's sidecar capability so the settings rail and MCP tab can
  // read it synchronously; fire-and-forget like the key hydration above.
  void mcpServerStatus()
    .then((s) => useLabelStore.getState().setMcpSidecarAvailable(s.available))
    .catch(() => undefined);
  // Fire-and-forget: a failure here must not block paint, and the settings
  // tab re-kicks initMcpLifecycle and shows the reason.
  void initMcpLifecycle();
  let timeoutId: number | undefined;
  await Promise.race([
    applyLocale(locale),
    new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, LOCALE_BOOT_WAIT_MS);
    }),
  ]);
  window.clearTimeout(timeoutId);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
