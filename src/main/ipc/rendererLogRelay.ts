/**
 * Renderer → main log relay with size caps and token-bucket rate limiting.
 */

import { IPC } from '@shared/constants.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

const log = logger.child('ipc/renderer-log');

const MAX_RELAY_MSG_BYTES = 16 * 1024;
const MAX_RELAY_FIELDS_BYTES = 64 * 1024;
const RELAY_RATE_PER_SEC = 50;
const RELAY_BURST = 100;

const ALLOWED_LOG_LEVELS = new Set<'debug' | 'info' | 'warn' | 'error'>([
  'debug',
  'info',
  'warn',
  'error'
]);

export function registerRendererLogRelay(): void {
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
    return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8') + '…[truncated]';
  }

  function clampFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!fields) return undefined;
    let serialized: string;
    try {
      serialized = JSON.stringify(fields);
    } catch {
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
