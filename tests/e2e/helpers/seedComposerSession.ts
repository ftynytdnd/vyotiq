import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
export interface SeededComposerSession {
  workspaceId: string;
  conversationId: string;
}

export interface SeededE2EProvider {
  providerId: string;
  modelId: string;
}

/**
 * Register a minimal enabled provider with one discovered model (no network).
 */
export async function seedE2EProvider(window: Page): Promise<SeededE2EProvider> {
  return window.evaluate(async () => {
    const provider = await window.vyotiq.providers.add({
      name: 'E2E Provider',
      baseUrl: 'http://127.0.0.1:11434',
      apiKey: ''
    });
    await window.vyotiq.providers.update(provider.id, {
      enabled: true,
      models: [{ id: 'e2e-model', label: 'E2E Model' }]
    });
    return { providerId: provider.id, modelId: 'e2e-model' };
  });
}

/**
 * Upsert an enabled scheduled run bound to a seeded workspace conversation.
 */
export async function seedScheduledRun(
  window: Page,
  input: {
    workspaceId: string;
    conversationId: string;
    providerId: string;
    modelId: string;
    label?: string;
    prompt?: string;
  }
): Promise<string> {
  return window.evaluate(
    async ({ workspaceId, conversationId, providerId, modelId, label, prompt }) => {
      const run = await window.vyotiq.scheduledRuns.upsert({
        enabled: true,
        label: label ?? 'E2E schedule',
        workspaceId,
        conversationId,
        prompt: prompt ?? 'Run the hourly check',
        providerId,
        modelId,
        intervalMinutes: 60
      });
      return run.id;
    },
    input
  );
}

/**
 * Workspace + provider + fresh empty chat on the centered landing composer.
 */
export async function prepareLandingComposer(
  window: Page,
  workspacePath: string
): Promise<SeededComposerSession> {
  const session = await seedComposerSession(window, workspacePath);
  await seedE2EProvider(window);
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await waitForComposerSession(window);
  await expect(window.getByLabel(/^Message /)).toBeVisible();
  await expect(window.getByText('Loading conversation…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByRole('button', { name: 'New chat' }).click();
  await expect(window.locator('[data-e2e-can-attach="true"]')).toBeVisible({ timeout: 15_000 });
  return session;
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
    const settings = await window.vyotiq.settings.get();
    await window.vyotiq.settings.set({
      ui: {
        ...(settings.ui ?? {}),
        activeConversationByWorkspace: {
          ...(settings.ui?.activeConversationByWorkspace ?? {}),
          [workspace.id]: conversation.id
        }
      }
    });
    return { workspaceId: workspace.id, conversationId: conversation.id };
  }, workspacePath);
}

/** Stub clipboard blob ingest IPC via main-process handler replacement. */
export async function stubIngestClipboardImage(
  window: Page,
  electronApp: ElectronApplication
): Promise<void> {
  const channel = 'attachments:ingest-clipboard';
  const legacyChannel = 'attachments:ingest-clipboard-image';
  await electronApp.evaluate(
    async ({ ipcMain, BrowserWindow }, channels: { batch: string; legacy: string }) => {
      const stubMeta = {
        id: 'e2e-clipboard-attach',
        name: 'clipboard-e2e.png',
        storedPath: 'attachments/e2e/clipboard-e2e.png',
        mimeType: 'image/png',
        mediaKind: 'image',
        sizeBytes: 42
      };
      const recordCall = async (input: unknown) => {
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
      };
      ipcMain.removeHandler(channels.batch);
      ipcMain.removeHandler(channels.legacy);
      ipcMain.handle(channels.batch, async (_event, input: unknown) => {
        await recordCall(input);
        return [stubMeta];
      });
      ipcMain.handle(channels.legacy, async (_event, input: unknown) => {
        await recordCall(input);
        return stubMeta;
      });
    },
    { batch: channel, legacy: legacyChannel }
  );
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

/** Reload after seeding and open a fresh chat with an attach-ready composer. */
export async function prepareActiveComposer(
  window: Page,
  workspacePath: string
): Promise<SeededComposerSession> {
  const session = await seedComposerSession(window, workspacePath);
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await waitForComposerSession(window);
  await expect(window.getByLabel(/^Message /)).toBeVisible();
  await expect(window.getByText('Loading conversation…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByRole('button', { name: 'New chat' }).click();
  await expect(window.locator('[data-e2e-can-attach="true"]')).toBeVisible({ timeout: 15_000 });
  return session;
}

/** Type into the contenteditable composer (triggers slash / mention pickers). */
export async function typeInComposer(window: Page, text: string): Promise<void> {
  const composer = window.getByLabel(/^Message /);
  await composer.click();
  await composer.pressSequentially(text, { delay: 15 });
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