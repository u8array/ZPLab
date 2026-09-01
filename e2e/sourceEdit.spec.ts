import { test, expect, type Page } from '@playwright/test';

/** Real-browser coverage for the focus-implicit source-edit session: the raw
 *  pointerdown/focusout/Escape listeners have no jsdom-faithful equivalent. */

const SAMPLE_ZPL = '^XA\n^FO50,50^A0N,30,0^FDHello World^FS\n^XZ';

const openOutput = async (page: Page) => {
  await page.getByRole('button', { name: 'Expand' }).click();
  return page.getByRole('region', { name: 'ZPL' }).getByRole('textbox');
};

const importSample = async (page: Page) => {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Import ZPL' }).click();
  await page.getByRole('textbox').fill(SAMPLE_ZPL);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  return openOutput(page);
};

const retype = async (page: Page, output: ReturnType<Page['locator']>, zpl: string) => {
  await output.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(zpl);
};

test('a blank document accepts ZPL typed straight into the pane', async ({ page }) => {
  await page.goto('/');
  const output = await openOutput(page);
  await output.click();
  await page.keyboard.type('^XA^FO10,10^A0N,30,30^FDscratch^FS^XZ');
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();

  await page.locator('main').click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole('button', { name: 'Apply' })).toBeHidden();
  await expect(output).toContainText('^FDscratch');
});

test('a clean edit applies on the outside click that leaves the panel', async ({ page }) => {
  await page.goto('/');
  const output = await importSample(page);
  await retype(page, output, '^XA^FO10,10^A0N,30,30^FDedited^FS^XZ');
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();

  await page.locator('main').click({ position: { x: 20, y: 20 } });
  // Session over, buffer committed, no dialog.
  await expect(page.getByRole('button', { name: 'Apply' })).toBeHidden();
  await expect(output).toContainText('^FDedited');
});

test('a multi-page edit applied by an outside click stays on the current page', async ({ page }) => {
  await page.goto('/');
  const output = await importSample(page);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();

  await retype(
    page,
    output,
    '^XA^FO10,10^A0N,30,30^FDp1^FS^XZ\n^XA^FO10,10^A0N,30,30^FDp2^FS^XZ',
  );
  await page.locator('main').click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole('button', { name: 'Apply' })).toBeHidden();
  // The implicit apply must not yank the user back to page 1.
  await expect(page.getByText('2 / 2')).toBeVisible();
});

test('an unbalanced draft shows a positioned lint error while typing', async ({ page }) => {
  await page.goto('/');
  const output = await importSample(page);
  // The stray ^XZ is the TRAILING one, so an implementation anchoring every
  // kind at offset 0 would mark the opening ^XA and fail here.
  await retype(page, output, '^XA^FO10,10^A0N,30,30^FDX^FS^XZ^XZ');
  await expect(page.locator('.cm-lintRange-error')).toHaveText('^XZ');
});

test('a device action gets a positioned warning mark while typing', async ({ page }) => {
  await page.goto('/');
  const output = await importSample(page);
  await retype(page, output, '^XA^FO10,10^A0N,30,30^FDX^FS^XZ~PH');
  await expect(page.locator('.cm-lintRange-warning')).toHaveText('~PH');
});

test('Escape asks to discard and restores the export', async ({ page }) => {
  await page.goto('/');
  const output = await importSample(page);
  await retype(page, output, '^XA^FO10,10^A0N,30,30^FDedited^FS^XZ');

  await page.keyboard.press('Escape');
  // The discard confirm is an alertdialog (destructive), unlike the apply dialog.
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('button', { name: 'Apply' })).toBeHidden();
  await expect(output).toContainText('^FDHello World');
  await expect(output).not.toContainText('^FDedited');
});

test('a held exit swallows the click on a real control (File menu stays closed)', async ({ page }) => {
  await page.goto('/');
  const output = await importSample(page);
  await retype(page, output, '^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ');

  // The click lands on a click-driven control; the held exit must stop it.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import ZPL' })).toBeHidden();
});

test('a lossy edit stops on the confirm dialog; cancel refocuses the editor', async ({ page }) => {
  await page.goto('/');
  const output = await importSample(page);
  // ^JZY carries a replay-risk finding, which forces the confirm dialog.
  await retype(page, output, '^XA^JZY^FO10,10^A0N,30,30^FDX^FS^XZ');

  await page.locator('main').click({ position: { x: 20, y: 20 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  // Cancel means keep editing: session alive, focus back in the editor,
  // and crucially the dialog must not loop straight back open.
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
  await expect(output).toBeFocused();
});
