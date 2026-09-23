# Development

## Stack

- [React 19](https://react.dev/) + TypeScript
- [Vite](https://vite.dev/)
- [Konva](https://konvajs.org/) / react-konva: canvas rendering
- [Zustand](https://github.com/pmndrs/zustand) + [zundo](https://github.com/charkour/zundo): state and undo history
- [bwip-js](https://github.com/metafloor/bwip-js): barcode rendering
- [Tailwind CSS v4](https://tailwindcss.com/)
- [CodeMirror 6](https://codemirror.net/): the ZPL source editor
- [Tauri](https://tauri.app/): desktop shell

## Architecture

- `packages/core`: domain logic, parser and generator, no React
- `packages/mcp-server`: the MCP server over `@zplab/core`
- `src/`: the React app, with `lib` helpers, `store` UI state and `components`
- `src-tauri/`: the desktop shell

The store holds each page as a list of objects plus the imported source. Only changes that affect the emitted ZPL regenerate an object. The rest of the source replays as imported.

## Build options

Set as environment variables for `pnpm build`, or as `--build-arg` for `docker build`:

- `VITE_LABELARY_API_URL`: the default Labelary endpoint. A user can change it in **Settings → App → Preview**.
- `VITE_THIRD_PARTY_LABELARY`: `false` disables Labelary previews for every user
- `VITE_LABELARY_API_KEY`: a key for a local `pnpm build` only, never for a published build. The Dockerfile does not accept it.
