/**
 * Screen/browser capture IPC.
 */

import { IPC } from '@shared/constants.js';
import type {
  CaptureBrowserInput,
  CaptureFrameResultInput,
  CaptureIngestFrameInput,
  CaptureListSourcesInput,
  CaptureListSourcesResult,
  CaptureResult,
  CaptureScreenInput,
  CaptureWindowInput
} from '@shared/types/capture.js';
import {
  captureByTarget,
  captureBrowserToWorkspace,
  ingestCaptureFrame,
  listCaptureSources
} from '../capture/captureManager.js';
import { settleCaptureFrameResult } from '../capture/captureFramebufferBridge.js';
import { registerCaptureDisplayWatch } from '../capture/captureDisplayWatch.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertBoolean, assertNumber, assertObject, assertString } from './validate.js';

export function registerCaptureIpc(): void {
  registerCaptureDisplayWatch();

  wrapIpcHandler(
    IPC.CAPTURE_LIST_SOURCES,
    async (_event, input?: CaptureListSourcesInput): Promise<CaptureListSourcesResult> => {
      const thumbnails = input?.thumbnails ?? false;
      const sources = await listCaptureSources({ thumbnails });
      return { sources };
    }
  );

  wrapIpcHandler(
    IPC.CAPTURE_INGEST_FRAME,
    async (_event, input: CaptureIngestFrameInput): Promise<CaptureResult> => {
      assertObject('capture:ingest-frame', 'input', input);
      assertString('capture:ingest-frame', 'workspaceId', input.workspaceId);
      assertString('capture:ingest-frame', 'conversationId', input.conversationId);
      assertString('capture:ingest-frame', 'messageId', input.messageId);
      assertNumber('capture:ingest-frame', 'width', input.width);
      assertNumber('capture:ingest-frame', 'height', input.height);
      if (!(input.png instanceof Uint8Array) || input.png.byteLength === 0) {
        throw new Error('capture:ingest-frame requires non-empty png bytes');
      }
      const workspacePath = await requireWorkspaceById(input.workspaceId);
      return ingestCaptureFrame({
        workspacePath,
        png: Buffer.from(input.png),
        width: input.width,
        height: input.height,
        prefix: input.prefix
      });
    }
  );

  wrapIpcHandler(
    IPC.CAPTURE_FRAME_RESULT,
    async (_event, input: CaptureFrameResultInput): Promise<{ ok: true }> => {
      assertObject('capture:frame-result', 'input', input);
      assertString('capture:frame-result', 'requestId', input.requestId);
      assertBoolean('capture:frame-result', 'ok', input.ok);
      settleCaptureFrameResult({
        requestId: input.requestId,
        ok: input.ok,
        png: input.png,
        width: input.width,
        height: input.height,
        error: input.error
      });
      return { ok: true };
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
