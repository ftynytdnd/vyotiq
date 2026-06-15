/**
 * `buildContextEnvelope` tests for the session-context work (plan §6):
 *
 *   Envelopes — three invariants guard the screenshots §4 regression:
 *     1. Empty-notes path emits the new unambiguous copy (NOT the
 *        legacy "no workspace notes have been written" string the agent
 *        misread as a session-freshness signal).
 *     2. `<session_context>` carries title + prior-turn count + last
 *        model when a `conversationId` is supplied AND found in the
 *        in-memory conversation index.
 *     3. The fallback "(none — first turn of a fresh conversation)"
 *        body fires when no id is passed or the id is unknown.
 *     4. A transient `listConversations` failure produces the
 *        distinct "session lookup failed" body (audit §2.4) so the
 *        model leans on its replayed history instead of mis-reading
 *        the failure as a fresh-session signal.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConversationMeta } from '@shared/types/chat';

// Mock the three dependencies `buildContextEnvelope` touches so the
// test can drive exact empty/populated paths without any real I/O.
// Declared BEFORE the mocked import so Vitest hoists them correctly.
vi.mock('@main/memory/retrieval', () => ({
  retrieveRelevantMemory: vi.fn()
}));
vi.mock('@main/workspace/workspaceState', () => ({
  getWorkspace: vi.fn()
}));
vi.mock('@main/conversations/conversationStore', () => ({
  listConversations: vi.fn()
}));
vi.mock('node:fs', () => ({
  promises: {
    readdir: vi.fn()
  }
}));

import { buildContextEnvelope } from '@main/orchestrator/contextManager';
import { retrieveRelevantMemory } from '@main/memory/retrieval';
import { getWorkspace } from '@main/workspace/workspaceState';
import { listConversations } from '@main/conversations/conversationStore';
import { promises as fs } from 'node:fs';
import os from 'node:os';

describe('buildContextEnvelope — session context (plan §6)', () => {
  beforeEach(() => {
    vi.mocked(getWorkspace).mockResolvedValue({ path: null, label: null });
    vi.mocked(retrieveRelevantMemory).mockResolvedValue({
      metaRules: '# meta',
      notes: []
    });
    vi.mocked(listConversations).mockResolvedValue([]);
  });

  /**
   * Empty-notes path MUST emit the unambiguous copy that distinguishes
   * "relevance miss" from "session-freshness signal". The legacy string
   * "(no workspace notes have been written for this query)" was
   * consistently misread by the agent as "this session is fresh" — see
   * screenshots §4. This test pins the phrasing so a future refactor
   * can't silently regress the fix.
   */
  it('emits the unambiguous empty-state copy when notes are empty', async () => {
    const env = await buildContextEnvelope('proceed');
    // The new (trimmed) empty-state copy still has to distinguish a
    // relevance miss from a freshness signal — the harness ("Context,
    // Memory & Research") explains the rule in detail so the envelope
    // can stay tight.
    expect(env.memoryXml).toContain('relevance miss');
    expect(env.memoryXml).toContain('Prior turns');
    // Explicitly assert the old confusing copy is GONE.
    expect(env.memoryXml).not.toContain('have been written for this query');
  });

  it('populates <session_context> with title + prior-turn count + model', async () => {
    const meta: ConversationMeta = {
      id: 'conv-1',
      title: 'hi, list files',
      createdAt: 0,
      updatedAt: 1,
      eventCount: 12,
      lastProviderId: 'deepseek',
      lastModelId: 'deepseek-v4-pro'
    };
    vi.mocked(listConversations).mockResolvedValue([meta]);

    const env = await buildContextEnvelope('proceed', 'conv-1');
    expect(env.sessionXml).toContain('<session_context>');
    expect(env.sessionXml).toContain('Conversation: "hi, list files"');
    expect(env.sessionXml).toContain('Prior turns persisted: 12');
    expect(env.sessionXml).toContain('Last model: deepseek/deepseek-v4-pro');
  });

  it('uses the "untitled" placeholder when the conversation still has the default title', async () => {
    vi.mocked(listConversations).mockResolvedValue([
      {
        id: 'conv-2',
        title: 'New conversation',
        createdAt: 0,
        updatedAt: 0,
        eventCount: 0
      }
    ]);
    const env = await buildContextEnvelope('hello', 'conv-2');
    // Title-derivation hasn't happened yet — must NOT echo the default
    // string verbatim because it would look like a real title to the
    // agent; use the explicit untitled marker instead.
    expect(env.sessionXml).toContain('(untitled');
    expect(env.sessionXml).not.toContain('Conversation: "New conversation"');
  });

  it('emits the fresh-conversation fallback when conversationId is omitted', async () => {
    const env = await buildContextEnvelope('anything');
    expect(env.sessionXml).toContain('first turn of a fresh conversation');
  });

  it('emits the fresh-conversation fallback when the id is unknown', async () => {
    vi.mocked(listConversations).mockResolvedValue([
      { id: 'other', title: 't', createdAt: 0, updatedAt: 0, eventCount: 3 }
    ]);
    const env = await buildContextEnvelope('hi', 'unknown-id');
    expect(env.sessionXml).toContain('first turn of a fresh conversation');
  });

  it('emits the distinct "session lookup failed" body when listConversations throws', async () => {
    vi.mocked(listConversations).mockRejectedValue(new Error('index bust'));
    const env = await buildContextEnvelope('q', 'any-id');
    // A transient index read error must not take down a live turn —
    // the envelope must still build. Per audit §2.4 the fallback is
    // now distinct from the fresh-conversation body so the model does
    // not mis-read a host-side failure as a session-freshness signal.
    expect(env.sessionXml).toContain('session lookup failed');
    expect(env.sessionXml).not.toContain('first turn of a fresh conversation');
  });
});

/**
 * `<prior_conversations>` envelope — cross-session directory of OTHER
 * conversations the agent might recall via the `recall` tool. Pins the
 * shape and the active-conversation exclusion so a future refactor
 * can't accidentally leak the active session into the directory or
 * blow past the row cap.
 */
describe('buildContextEnvelope — prior conversations (plan §C1)', () => {
  beforeEach(() => {
    vi.mocked(getWorkspace).mockResolvedValue({ path: null, label: null });
    vi.mocked(retrieveRelevantMemory).mockResolvedValue({
      metaRules: '# meta',
      notes: []
    });
  });

  it('renders the empty-state placeholder when only the active conversation exists', async () => {
    vi.mocked(listConversations).mockResolvedValue([
      { id: 'active', title: 't', createdAt: 0, updatedAt: 0, eventCount: 1 }
    ]);
    const env = await buildContextEnvelope('q', 'active');
    expect(env.priorConversationsXml).toContain('<prior_conversations>');
    expect(env.priorConversationsXml).toContain('first conversation');
    // Active id must NOT appear inside the envelope.
    expect(env.priorConversationsXml).not.toContain('id=active');
  });

  it('lists OTHER conversations and excludes the active one', async () => {
    const now = Date.now();
    vi.mocked(listConversations).mockResolvedValue([
      { id: 'active', title: 'current', createdAt: now, updatedAt: now, eventCount: 5 },
      { id: 'other-1', title: 'README task', createdAt: now - 60_000, updatedAt: now - 60_000, eventCount: 18 },
      { id: 'other-2', title: 'New conversation', createdAt: now - 600_000, updatedAt: now - 600_000, eventCount: 2 }
    ]);
    const env = await buildContextEnvelope('q', 'active');
    expect(env.priorConversationsXml).toContain('id=other-1');
    expect(env.priorConversationsXml).toContain('"README task"');
    // The default-title row should render the untitled marker, never echo
    // the literal "New conversation" string as a real title.
    expect(env.priorConversationsXml).toContain('(untitled)');
    expect(env.priorConversationsXml).toContain('id=other-2');
    // Active row excluded.
    expect(env.priorConversationsXml).not.toContain('id=active');
    // Inline `recall` guidance copy is intentionally NOT in this
    // envelope after the audit-pass subtraction — the harness
    // ("Context, Memory & Research" §A) carries that rule. Assert
    // that we did NOT regress and re-introduce the long footer text.
    expect(env.priorConversationsXml).not.toContain('CANNOT see the full content');
  });

  it('caps the row count and announces the elision', async () => {
    const now = Date.now();
    const overflow = Array.from({ length: 8 }, (_, i) => ({
      id: `c-${i}`,
      title: `t-${i}`,
      createdAt: now - i,
      updatedAt: now - i,
      eventCount: i
    }));
    vi.mocked(listConversations).mockResolvedValue(overflow);
    const env = await buildContextEnvelope('q', 'no-active');
    // Only the first 5 ids should appear; the rest must be elided
    // explicitly so the agent knows to call `recall list` for more.
    expect(env.priorConversationsXml).toContain('id=c-0');
    expect(env.priorConversationsXml).toContain('id=c-4');
    expect(env.priorConversationsXml).not.toContain('id=c-5');
    expect(env.priorConversationsXml).toMatch(/\d+ older conversations? not shown/);
  });

  it('emits the empty-state placeholder when the index throws', async () => {
    vi.mocked(listConversations).mockRejectedValue(new Error('index bust'));
    const env = await buildContextEnvelope('q', 'any');
    expect(env.priorConversationsXml).toContain('<prior_conversations>');
    expect(env.priorConversationsXml).toContain('first conversation');
  });

  it('redacts the user profile segment in <workspace_context>', async () => {
    const home = os.homedir();
    const workspacePath =
      process.platform === 'win32' ? `${home}\\vyotiq` : `${home}/vyotiq`;
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'src', isDirectory: () => true } as import('node:fs').Dirent
    ]);
    const env = await buildContextEnvelope('q', undefined, workspacePath);
    expect(env.workspaceXml).toContain('<workspace_context>');
    expect(env.workspaceXml).not.toContain(home);
    if (process.platform === 'win32') {
      expect(env.workspaceXml).toContain('%USERPROFILE%');
    } else {
      expect(env.workspaceXml).toContain('~/vyotiq');
    }
  });
});
