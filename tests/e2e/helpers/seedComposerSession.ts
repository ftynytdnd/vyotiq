import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
export interface SeededComposerSession {
  workspaceId: string;
  conversationId: string;
}

/**
 * Register a workspace + conversation and persist the active slot so a
 * reload restores `useChatStore.conversationId` via `restoreWorkspaceSession`.
 */
export async function seedComposerSession(
  window: Page,
  workspacePath: string
): Promise<SeededComposerSession> {
  return window.evaluate(async (wsPath) => {
    const workspace = await window.vyotiq.workspace.add(wsPath);
    if (!workspace) {
      throw new Error('workspace.add returned null');
    }
    const conversation = await window.vyotiq.conversations.create(workspace.id);
    await window.vyotiq.settings.set({
      ui: {
        activeConversationByWorkspace: {
          [workspace.id]: conversation.id
        }
      }
    });
    return { workspaceId: workspace.id, conversationId: conversation.id };
  }, workspacePath);
}

/** Stub clipboard-image ingest IPC via main-process handler replacement. */
export async function stubIngestClipboardImage(
  window: Page,
  electronApp: ElectronApplication
): Promise<void> {
  const channel = 'attachments:ingest-clipboard-image';
  await electronApp.evaluate(async ({ ipcMain, BrowserWindow }, ipcChannel: string) => {
    ipcMain.removeHandler(ipcChannel);
    ipcMain.handle(ipcChannel, async (_event, input: unknown) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        await win.webContents.executeJavaScript(
          `(() => {
            const w = window;
            w.__e2eIngestClipboardCalls = w.__e2eIngestClipboardCalls ?? [];
            w.__e2eIngestClipboardCalls.push(${JSON.stringify(input)});
          })()`
        );
      }
      return {
        id: 'e2e-clipboard-attach',
        name: 'clipboard-e2e.png',
        storedPath: 'attachments/e2e/clipboard-e2e.png',
        mimeType: 'image/png',
        mediaKind: 'image',
        sizeBytes: 42
      };
    });
  }, channel);
  await window.evaluate(() => {
    (window as Window & { __e2eIngestClipboardCalls?: unknown[] }).__e2eIngestClipboardCalls = [];
  });
}

export async function readIngestClipboardCalls(window: Page): Promise<unknown[]> {
  return window.evaluate(() => {
    const w = window as Window & { __e2eIngestClipboardCalls?: unknown[] };
    return w.__e2eIngestClipboardCalls ?? [];
  });
}

/** Wait until the composer has an active workspace + conversation mirror. */
export async function waitForComposerSession(window: Page): Promise<void> {
  await expect.poll(
    async () =>
      window.evaluate(() => {
        const root = document.querySelector('#root');
        if (!root || root.textContent?.includes('Open a workspace to begin')) return false;
        return true;
      }),
    { timeout: 15_000 }
  ).toBe(true);

  await expect.poll(
    async () =>
      window.evaluate(async () => {
        const state = await window.vyotiq.workspace.list();
        if (!state.activeId) return false;
        const settings = await window.vyotiq.settings.get();
        const convId = settings.ui?.activeConversationByWorkspace?.[state.activeId];
        return typeof convId === 'string' && convId.length > 0;
      }),
    { timeout: 15_000 }
  ).toBe(true);
}

/** Dispatch a synthetic image paste on the composer (DataTransfer + image/png File). */
export async function pasteClipboardImage(window: Page): Promise<void> {
  const composer = window.getByLabel(/^Message /);
  await composer.click();
  await composer.evaluate((el) => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);
    const file = new File([png], 'clip.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    el.dispatchEvent(event);
  });
}