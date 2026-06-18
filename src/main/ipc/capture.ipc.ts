/**
 * Screen/browser capture IPC.
 */

import { IPC } from '@shared/constants.js';
import type {
  CaptureBrowserInput,
  CaptureListSourcesResult,
  CaptureResult,
  CaptureScreenInput,
  CaptureWindowInput
} from '@shared/types/capture.js';
import {
  captureByTarget,
  captureBrowserToWorkspace,
  listCaptureSources
} from '../capture/captureManager.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertObject, assertString } from './validate.js';

export function registerCaptureIpc(): void {
  wrapIpcHandler(
    IPC.CAPTURE_LIST_SOURCES,
    async (): Promise<CaptureListSourcesResult> => {
      const sources = await listCaptureSources();
      return { sources };
    }
  );

  wrapIpcHandler(
    IPC.CAPTURE_SCREEN,
    async (_event, input: CaptureScreenInput): Promise<CaptureResult> => {
      assertObject('capture:screen', 'input', input);
      assertString('capture:screen', 'workspaceId', input.workspaceId);
      assertString('capture:screen', 'sourceId', input.sourceId);
      const workspacePath = await requireWorkspaceById(input.workspaceId);
      return captureByTarget(workspacePath, 'screen', input.sourceId);
    }
  );

  wrapIpcHandler(
    IPC.CAPTURE_BROWSER,
    async (_event, input: CaptureBrowserInput): Promise<CaptureResult> => {
      assertObject('capture:browser', 'input', input);
      assertString('capture:browser', 'workspaceId', input.workspaceId);
      const workspacePath = await requireWorkspaceById(input.workspaceId);
      return captureBrowserToWorkspace(workspacePath);
    }
  );

  wrapIpcHandler(
    IPC.CAPTURE_WINDOW,
    async (_event, input: CaptureWindowInput): Promise<CaptureResult> => {
      assertObject('capture:window', 'input', input);
      assertString('capture:window', 'workspaceId', input.workspaceId);
      const workspacePath = await requireWorkspaceById(input.workspaceId);
      return captureByTarget(workspacePath, 'window');
    }
  );

  wrapIpcHandler(
    IPC.BROWSER_CAPTURE,
    async (_event, input: CaptureBrowserInput): Promise<CaptureResult> => {
      assertObject('browser:capture', 'input', input);
      assertString('browser:capture', 'workspaceId', input.workspaceId);
      const workspacePath = await requireWorkspaceById(input.workspaceId);
      return captureBrowserToWorkspace(workspacePath);
    }
  );
}
