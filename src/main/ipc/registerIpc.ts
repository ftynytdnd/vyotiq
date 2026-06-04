/**
 * Central IPC registrar. Called once during main bootstrap.
 */

import { registerWindowIpc } from './window.ipc.js';
import { registerWorkspaceIpc } from './workspace.ipc.js';
import { registerProvidersIpc } from './providers.ipc.js';
import { registerChatIpc } from './chat.ipc.js';
import { registerToolsIpc } from './tools.ipc.js';
import { registerMemoryIpc } from './memory.ipc.js';
import { registerSettingsIpc } from './settings.ipc.js';
import { registerConversationsIpc } from './conversations.ipc.js';
import { registerCheckpointsIpc } from './checkpoints.ipc.js';
import { registerAppIpc } from './app.ipc.js';
import { registerAttachmentsIpc } from './attachments.ipc.js';
import { registerRendererLogRelay } from './rendererLogRelay.js';
import {
  abortRunsForConversation,
  abortRunsForProvider,
  abortRunsForWorkspace
} from '../orchestrator/AgentV.js';
import { setRunAbortHooks } from '../conversations/conversationStore.js';
import { setProviderAbortHook } from '../providers/providerStore.js';

export function registerIpc(): void {
  setRunAbortHooks({
    abortRunsForConversation,
    abortRunsForWorkspace
  });
  setProviderAbortHook(abortRunsForProvider);

  registerWindowIpc();
  registerWorkspaceIpc();
  registerProvidersIpc();
  registerChatIpc();
  registerToolsIpc();
  registerMemoryIpc();
  registerSettingsIpc();
  registerConversationsIpc();
  registerCheckpointsIpc();
  registerAppIpc();
  registerAttachmentsIpc();
  registerRendererLogRelay();
}
