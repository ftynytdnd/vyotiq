import type { ElectronApplication } from '@playwright/test';

/**
 * Stub native OS dialogs in the Electron main process so smoke tests never
 * block on folder pickers or message boxes. Pattern from Playwright Electron
 * docs (2026): destructure `{ dialog }` from the evaluate callback argument.
 */
export async function stubNativeDialogs(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(async ({ dialog }) => {
    const canceledOpen = { canceled: true as const, filePaths: [] as string[] };
    dialog.showOpenDialog = async () => canceledOpen;
    dialog.showOpenDialogSync = () => canceledOpen;

    const canceledSave = { canceled: true as const, filePath: undefined as string | undefined };
    dialog.showSaveDialog = async () => canceledSave;
    dialog.showSaveDialogSync = () => canceledSave;

    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showMessageBoxSync = () => ({ response: 0, checkboxChecked: false });
  });
}
