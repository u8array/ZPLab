/** Neutral form-control style primitives shared across feature modules. */
export const inputCls = 'w-full bg-surface-2 border border-border rounded px-2 py-1 text-xs font-mono text-text focus:border-accent focus:outline-none';
export const labelCls = 'font-mono text-[10px] text-muted uppercase tracking-wider';
/** Secondary-action button: file upload, toggle row, etc. Matches the
 *  surface-2 + border styling used by `inputCls` so buttons sit naturally
 *  next to form fields without dominating the visual hierarchy. */
export const buttonCls = 'px-3 py-1.5 rounded text-xs font-mono bg-surface-2 border border-border text-text hover:bg-border transition-colors';
/** `buttonCls` hovers, so a disabled button needs its hover taken back too. */
export const disabledCls = 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-2';
/** Content-builder launch button under a token field. Disabled while a variable
 *  is present, since the builder writes a literal that can't coexist with chips. */
export const builderButtonCls = `self-start text-xs px-2 py-1 rounded border border-border bg-surface-2 hover:bg-border transition-colors ${disabledCls}`;
/** Read-only ZPL command tag shown next to a field, e.g. `^A`. One style
 *  across the app (properties fields + Printer Settings tabs) so the command
 *  hint reads the same everywhere. */
export const zplCommandTagCls = 'font-mono text-[10px] text-muted/60 tracking-tight shrink-0';
/** Subgrid aligns labels and controls across sibling cells. Pair `fieldGridCols`
 *  on the container (with `grid grid-cols-N`) with `fieldGridCell` on each cell. */
export const fieldGridCols = 'gap-x-2 gap-y-1 grid-rows-[auto_auto]';
export const fieldGridCell = 'grid grid-rows-subgrid row-span-2';
