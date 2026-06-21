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
import { registerHarnessIpc } from './harness.ipc.js';
import { registerAppIpc } from './app.ipc.js';
import { registerAttachmentsIpc } from './attachments.ipc.js';
import { registerRendererLogRelay } from './rendererLogRelay.js';
import { registerTokensIpc } from './tokens.ipc.js';
import { registerReportsIpc } from './reports.ipc.js';
import { registerContextIpc } from './context.ipc.js';
import { registerEditorIpc } from './editor.ipc.js';
import { registerTerminalIpc } from './terminal.ipc.js';
import { registerBrowserIpc } from './browser.ipc.js';
import { registerCaptureIpc } from './capture.ipc.js';
import { registerCompletionIpc } from './completion.ipc.js';
import { registerLspIpc } from './lsp.ipc.js';
import { registerMentionsIpc } from './mentions.ipc.js';
import { registerScheduledRunsIpc } from './scheduledRuns.ipc.js';
import { registerHeartbeatIpc } from './heartbeat.ipc.js';
import { registerFollowUpsIpc } from './followUps.ipc.js';
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
  registerTokensIpc();
  registerChatIpc();
  registerToolsIpc();
  registerReportsIpc();
  registerContextIpc();
  registerEditorIpc();
  registerTerminalIpc();
  registerBrowserIpc();
  registerCaptureIpc();
  registerCompletionIpc();
  registerLspIpc();
  registerMentionsIpc();
  registerMemoryIpc();
  registerSettingsIpc();
  registerConversationsIpc();
  registerCheckpointsIpc();
  registerHarnessIpc();
  registerAppIpc();
  registerAttachmentsIpc();
  registerRendererLogRelay();
  registerScheduledRunsIpc();
  registerHeartbeatIpc();
  registerFollowUpsIpc();
}
