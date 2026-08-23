import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// Ship the generated attribution into dist/ so the notices accompany the
// redistributed code in the deployed app. Both the npm (repo root) and the Rust
// (src-tauri, cargo-about) files are Markdown and land side by side in dist/;
// for the Tauri build this dist/ is the frontendDist that gets bundled, so the
// Rust notices ride along without a separate tauri `resources` entry.
const LICENSE_FILES = [
  { fileName: 'THIRD-PARTY-LICENSES.md', src: './THIRD-PARTY-LICENSES.md' },
  { fileName: 'THIRD-PARTY-LICENSES-RUST.md', src: './src-tauri/THIRD-PARTY-LICENSES-RUST.md' },
]

function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      for (const { fileName, src } of LICENSE_FILES) {
        const path = fileURLToPath(new URL(src, import.meta.url))
        // Normalise to LF so the shipped notice is byte-stable no matter the
        // checkout's line endings (cargo-about copies some crate texts verbatim,
        // CRLF included; the committed blob is LF via .gitattributes).
        const source = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Tauri drives Vite via `tauri dev`: pin the port its devUrl points at and
  // skip watching the Rust crate, whose builds would trigger phantom reloads.
  // Plain web dev keeps Vite's port fallback (TAURI_ENV_* only set by tauri).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: !!process.env.TAURI_ENV_PLATFORM,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  plugins: [
    tailwindcss(),
    react(),
    // .ts included: hooks live there too and lose memoization outside the
    // compiler (the emit re-ran per render). Headless packages stay out.
    babel({
      presets: [reactCompilerPreset()],
      include: /\.tsx?$/,
      exclude: [/node_modules/, /[\\/]packages[\\/]/],
    }),
    thirdPartyLicenses(),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
})
