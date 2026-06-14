/**
 * Embedded web browser (Globe) IPC — drives the main-process WebContentsView.
 */

import { IPC } from '@shared/constants.js';
import type {
  BrowserAttachInput,
  BrowserAttachResult,
  BrowserFindInput,
  BrowserNavigateInput,
  BrowserSetBoundsInput,
  BrowserSetVisibleInput
} from '@shared/types/browser.js';
import {
  browserAttach,
  browserBack,
  browserDestroy,
  browserFind,
  browserForward,
  browserNavigate,
  browserReload,
  browserSetBounds,
  browserSetVisible,
  browserStop,
  browserStopFind
} from '../window/browserManager.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertNumber, assertObject, assertString } from './validate.js';

export function registerBrowserIpc(): void {
  wrapIpcHandler(
    IPC.BROWSER_ATTACH,
    async (_event, input?: BrowserAttachInput): Promise<BrowserAttachResult> => {
      if (input !== undefined) assertObject('browser:attach', 'input', input);
      const url = input?.url;
      if (url !== undefined) assertString('browser:attach', 'url', url, { maxBytes: 8 * 1024 });
      return { ok: true, state: browserAttach(url) };
    }
  );

  wrapIpcHandler(IPC.BROWSER_NAVIGATE, async (_event, input: BrowserNavigateInput) => {
    assertObject('browser:navigate', 'input', input);
    assertString('browser:navigate', 'url', input.url, { maxBytes: 8 * 1024 });
    browserNavigate(input.url);
  });

  wrapIpcHandler(IPC.BROWSER_BACK, async () => browserBack());
  wrapIpcHandler(IPC.BROWSER_FORWARD, async () => browserForward());
  wrapIpcHandler(IPC.BROWSER_RELOAD, async () => browserReload());
  wrapIpcHandler(IPC.BROWSER_STOP, async () => browserStop());

  wrapIpcHandler(IPC.BROWSER_SET_BOUNDS, async (_event, input: BrowserSetBoundsInput) => {
    assertObject('browser:set-bounds', 'input', input);
    assertObject('browser:set-bounds', 'bounds', input.bounds);
    assertNumber('browser:set-bounds', 'x', input.bounds.x, { min: -100000, max: 100000 });
    assertNumber('browser:set-bounds', 'y', input.bounds.y, { min: -100000, max: 100000 });
    assertNumber('browser:set-bounds', 'width', input.bounds.width, { min: 0, max: 100000 });
    assertNumber('browser:set-bounds', 'height', input.bounds.height, { min: 0, max: 100000 });
    browserSetBounds(input.bounds);
  });

  wrapIpcHandler(IPC.BROWSER_SET_VISIBLE, async (_event, input: BrowserSetVisibleInput) => {
    assertObject('browser:set-visible', 'input', input);
    browserSetVisible(input.visible === true);
  });

  wrapIpcHandler(IPC.BROWSER_FIND, async (_event, input: BrowserFindInput) => {
    assertObject('browser:find', 'input', input);
    assertString('browser:find', 'text', input.text, { nonEmpty: false, maxBytes: 4 * 1024 });
    browserFind(input);
  });

  wrapIpcHandler(IPC.BROWSER_STOP_FIND, async () => browserStopFind());
  wrapIpcHandler(IPC.BROWSER_DESTROY, async () => browserDestroy());
}

export function teardownBrowserIpc(): void {
  browserDestroy();
}
