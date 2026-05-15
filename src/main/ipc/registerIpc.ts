/**
 * Central IPC registrar. Called once during main bootstrap.
 */

import { IPC } from '@shared/constants.js';
import { registerWindowIpc } from './window.ipc.js';
import { registerWorkspaceIpc } from './workspace.ipc.js';
import { registerProvidersIpc } from './providers.ipc.js';
import { registerChatIpc } from './chat.ipc.js';
import { registerToolsIpc } from './tools.ipc.js';
import { registerMemoryIpc } from './memory.ipc.js';
import { registerSettingsIpc } from './settings.ipc.js';
import { registerConversationsIpc } from './conversations.ipc.js';
import { registerTokensIpc } from './tokens.ipc.js';
import { registerCheckpointsIpc } from './checkpoints.ipc.js';
import { registerAppIpc } from './app.ipc.js';
import {
  abortRunsForConversation,
  abortRunsForWorkspace
} from '../orchestrator/AgentV.js';
import { setRunAbortHooks } from '../conversations/conversationStore.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

const log = logger.child('ipc/renderer-log');

export function registerIpc(): void {
  // Wire the conversation store's run-abort hooks BEFORE any IPC
  // registration so a `removeConversation` triggered during early-boot
  // cleanup (rare but possible: a queued IPC call landing before the
  // first window paint) sees the live abort path. Kept here rather
  // than in `index.ts` so the hook plumbing lives next to the rest of
  // the cross-module wiring.
  setRunAbortHooks({
    abortRunsForConversation,
    abortRunsForWorkspace
  });

  registerWindowIpc();
  registerWorkspaceIpc();
  registerProvidersIpc();
  registerChatIpc();
  registerToolsIpc();
  registerMemoryIpc();
  registerSettingsIpc();
  registerConversationsIpc();
  registerTokensIpc();
  registerCheckpointsIpc();
  registerAppIpc();

  // Renderer → main log relay (used by the React error boundary).
  wrapIpcHandler(
    IPC.RENDERER_LOG,
    async (
      _event,
      level: 'debug' | 'info' | 'warn' | 'error',
      msg: string,
      fields?: Record<string, unknown>
    ) => {
      const safeMsg = typeof msg === 'string' ? msg : String(msg);
      const safeFields = fields && typeof fields === 'object' ? fields : undefined;
      switch (level) {
        case 'debug': log.debug(safeMsg, safeFields); break;
        case 'info': log.info(safeMsg, safeFields); break;
        case 'warn': log.warn(safeMsg, safeFields); break;
        case 'error':
        default: log.error(safeMsg, safeFields); break;
      }
    }
  );
}
