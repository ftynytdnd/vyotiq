/**
 * Runtime validation for follow-up rows loaded from disk.
 */

import type { FollowUpKind, FollowUpMessage, FollowUpSource } from '../types/followUp.js';
import type { ModelSelection } from '../types/provider.js';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function parseKind(v: unknown): FollowUpKind | null {
  return v === 'steering' || v === 'queue' ? v : null;
}

function parseSource(v: unknown): FollowUpSource | null {
  return v === 'composer' || v === 'scheduled' ? v : null;
}

function parseSelection(v: unknown): ModelSelection | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isNonEmptyString(o.providerId) || !isNonEmptyString(o.modelId)) return null;
  const sel: ModelSelection = { providerId: o.providerId, modelId: o.modelId };
  if (o.thinkingEffort === 'low' || o.thinkingEffort === 'medium' || o.thinkingEffort === 'high') {
    sel.thinkingEffort = o.thinkingEffort;
  }
  return sel;
}

/** Returns a normalized follow-up row or null when the payload is invalid. */
export function parseFollowUpMessage(raw: unknown): FollowUpMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = o.id;
  const kind = parseKind(o.kind);
  const selection = parseSelection(o.selection);
  const source = parseSource(o.source) ?? 'composer';
  if (!isNonEmptyString(id) || !kind || !selection) return null;
  if (typeof o.prompt !== 'string') return null;
  if (typeof o.queuedAt !== 'number' || !Number.isFinite(o.queuedAt)) return null;

  const message: FollowUpMessage = {
    id,
    kind,
    prompt: o.prompt,
    selection,
    queuedAt: o.queuedAt,
    source
  };

  if (Array.isArray(o.attachmentMeta) && o.attachmentMeta.length > 0) {
    message.attachmentMeta = o.attachmentMeta as FollowUpMessage['attachmentMeta'];
  }
  if (Array.isArray(o.mentions) && o.mentions.length > 0) {
    message.mentions = o.mentions as FollowUpMessage['mentions'];
  }
  if (isNonEmptyString(o.promptEventId)) {
    message.promptEventId = o.promptEventId;
  }

  return message;
}
