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
import { registerAttachmentsIpc } from './attachments.ipc.js';
import { registerContextSummaryIpc } from './contextSummary.ipc.js';
import {
  abortRunsForConversation,
  abortRunsForProvider,
  abortRunsForWorkspace
} from '../orchestrator/AgentV.js';
import { setRunAbortHooks } from '../conversations/conversationStore.js';
import { setProviderAbortHook } from '../providers/providerStore.js';
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
  // Audit fix L-07: wire `removeProvider` → `abortRunsForProvider` so
  // deleting a provider mid-run aborts every in-flight loop pinned to
  // that provider immediately, instead of letting later iterations
  // fail at `getProviderWithKey` lookup.
  setProviderAbortHook(abortRunsForProvider);

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
  registerAttachmentsIpc();
  registerContextSummaryIpc();

  // Renderer → main log relay (used by the React error boundary).
  //
  // Audit fix M-04: the renderer can dispatch unbounded `vyotiq.log`
  // calls (a render-loop crash inside an error boundary, a chatty
  // dev-build component, or a malicious page if isolation ever
  // regresses). Without limits each call hits `winston.log` →
  // synchronous JSON serialization → disk write through the file
  // transport, which can pin the main thread under heavy churn.
  //
  // The relay applies:
  //   1. A per-message-size cap (`MAX_RELAY_MSG_BYTES`) so a single
  //      log entry can't ship a megabyte of stack trace through IPC.
  //   2. A token-bucket rate limit (`RELAY_RATE_PER_SEC` log entries
  //      per second, burst capacity `RELAY_BURST`). Overflow log
  //      entries are dropped with a single aggregate warning that
  //      ticks at most once per second so the file isn't spammed.
  //   3. `fields` cap (`MAX_RELAY_FIELDS_BYTES`) on the serialized
  //      structured-fields payload — the heaviest live channel for
  //      accidental log-flood (stack traces, full event dumps).
  const MAX_RELAY_MSG_BYTES = 16 * 1024;
  const MAX_RELAY_FIELDS_BYTES = 64 * 1024;
  const RELAY_RATE_PER_SEC = 50;
  const RELAY_BURST = 100;

  let relayTokens = RELAY_BURST;
  let relayLastRefillMs = Date.now();
  let relayDroppedSinceWarnMs = 0;
  let relayDroppedCount = 0;

  function takeRelayToken(): boolean {
    const now = Date.now();
    const elapsed = (now - relayLastRefillMs) / 1000;
    if (elapsed > 0) {
      relayTokens = Math.min(RELAY_BURST, relayTokens + elapsed * RELAY_RATE_PER_SEC);
      relayLastRefillMs = now;
    }
    if (relayTokens >= 1) {
      relayTokens -= 1;
      return true;
    }
    return false;
  }

  function maybeWarnDrops(): void {
    const now = Date.now();
    if (relayDroppedCount > 0 && now - relayDroppedSinceWarnMs >= 1000) {
      log.warn('renderer log relay dropped messages (rate-limited)', {
        dropped: relayDroppedCount
      });
      relayDroppedCount = 0;
      relayDroppedSinceWarnMs = now;
    }
  }

  function clampString(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
    // Cheap byte-aware clamp: walk back from the byte cap to the
    // nearest valid UTF-8 boundary. Buffer.slice() can split a
    // multi-byte codepoint; `.toString('utf8')` replaces the partial
    // codepoint with U+FFFD which is fine for a log breadcrumb.
    return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8') + '…[truncated]';
  }

  function clampFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!fields) return undefined;
    // Serialize once to measure; if it's already inside the cap we
    // return the original object so winston can keep its native
    // structured-field handling.
    let serialized: string;
    try {
      serialized = JSON.stringify(fields);
    } catch {
      // Cyclic / non-serializable — replace with a stub so the rest
      // of the log entry still lands.
      return { __relay_warning: 'fields were not JSON-serializable; dropped' };
    }
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_RELAY_FIELDS_BYTES) {
      return fields;
    }
    return {
      __relay_warning: 'fields exceeded the relay cap; truncated',
      preview: clampString(serialized, MAX_RELAY_FIELDS_BYTES)
    };
  }

  // Audit fix 2026-06-P2-2 / 12-P2-4: validate `level` against an
  // explicit allow-list before routing into winston. Pre-fix the
  // `default` arm of the switch silently mapped any unknown level
  // into `log.error`, which (a) corrupts log-level statistics if the
  // renderer ships e.g. `'crash'` instead of `'error'`, and (b)
  // gives a malicious or buggy renderer a way to forge fake
  // error-level log lines that look authoritative. The `Set` lookup
  // is O(1) and we surface the rejection on a single warn line so a
  // legitimate level-name regression is still triageable.
  const ALLOWED_LOG_LEVELS = new Set<'debug' | 'info' | 'warn' | 'error'>([
    'debug',
    'info',
    'warn',
    'error'
  ]);

  wrapIpcHandler(
    IPC.RENDERER_LOG,
    async (
      _event,
      level: 'debug' | 'info' | 'warn' | 'error',
      msg: string,
      fields?: Record<string, unknown>
    ) => {
      if (!takeRelayToken()) {
        relayDroppedCount += 1;
        maybeWarnDrops();
        return;
      }
      maybeWarnDrops();
      const safeMsg = clampString(
        typeof msg === 'string' ? msg : String(msg),
        MAX_RELAY_MSG_BYTES
      );
      const safeFields = clampFields(
        fields && typeof fields === 'object' ? fields : undefined
      );
      const safeLevel: 'debug' | 'info' | 'warn' | 'error' =
        typeof level === 'string' && ALLOWED_LOG_LEVELS.has(level as never)
          ? (level as 'debug' | 'info' | 'warn' | 'error')
          : 'warn';
      if (safeLevel !== level) {
        // Surface the rejection ONCE per call so a legitimate typo
        // is triageable, but route the original message at the
        // safe-fallback level instead of silently promoting it to
        // `error`. The audit fix's contract is "never let an
        // unknown level look like a crash".
        log.warn('renderer log relay rejected unknown level', {
          received: typeof level === 'string' ? level.slice(0, 40) : typeof level
        });
      }
      switch (safeLevel) {
        case 'debug': log.debug(safeMsg, safeFields); break;
        case 'info': log.info(safeMsg, safeFields); break;
        case 'warn': log.warn(safeMsg, safeFields); break;
        case 'error': log.error(safeMsg, safeFields); break;
      }
    }
  );
}
