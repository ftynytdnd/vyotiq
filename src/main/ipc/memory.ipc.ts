/**
 * Memory IPC. Read/write the markdown memory store from the renderer
 * (Settings → Memory tab can browse it).
 */

import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import { IPC } from '@shared/constants.js';
import type { MemoryEntry } from '@shared/types/ipc.js';
import {
  appendGlobalMetaRule,
  globalMetaFilePath,
  readGlobalMetaRules,
  writeGlobalMetaRules
} from '../memory/globalMeta.js';
import {
  listWorkspaceNotes,
  readWorkspaceNote,
  workspaceNotePath,
  writeWorkspaceNote
} from '../memory/workspaceNotes.js';
import { isPerConversationRunProgressKey } from '../memory/runProgressNote.js';
import {
  getGlobalMemoryLastReference,
  getMemoryLastReference,
  GLOBAL_MEMORY_KEY,
  listMemoryLastReferences,
  touchGlobalMemoryLastReference,
  touchMemoryLastReference
} from '../memory/lastReferenced.js';
import { scheduleWorkspaceVectorIndex } from '../memory/vector/indexScheduler.js';
import { getActiveWorkspace } from '../workspace/workspaceState.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
// Audit fix 2026-06-P2-1 — shape gates so `memory:write` can't be
// fed a non-string `content` (would corrupt the persisted markdown)
// or a `mode` value outside the documented enum.
import {
  assertString,
  assertEnum,
  assertObject,
  assertBoolean
} from './validate.js';

// Hard cap on memory bodies. The renderer's MemoryPanel doesn't enforce
// this on the textarea, but a malformed / out-of-band caller pushing a
// 50 MB note would otherwise pin the main process on the atomic write.
// 256 KB is comfortably above any human-written meta-rule and well below
// the orchestrator envelope's 32 KB-per-file inline cap.
const MAX_MEMORY_CONTENT_BYTES = 256 * 1024;

const MEMORY_SCOPES = ['global', 'workspace'] as const;
const MEMORY_WRITE_MODES = ['set', 'append'] as const;

function withLastReference(
  entry: MemoryEntry,
  ref: Awaited<ReturnType<typeof getMemoryLastReference>>
): MemoryEntry {
  if (!ref) return entry;
  return {
    ...entry,
    lastReferencedAt: ref.at,
    lastReferencedConversationId: ref.conversationId,
    lastReferencedConversationTitle: ref.conversationTitle
  };
}

async function activeWorkspaceId(): Promise<string | null> {
  const ws = await getActiveWorkspace();
  return ws?.id ?? null;
}

export function registerMemoryIpc(): void {
  wrapIpcHandler(
    IPC.MEMORY_LIST,
    async (_event, scope: 'global' | 'workspace', opts?: { keysOnly?: boolean }) => {
      assertEnum('memory:list', 'scope', scope, MEMORY_SCOPES);
      if (opts !== undefined) {
        assertObject('memory:list', 'opts', opts);
        if (opts.keysOnly !== undefined) {
          assertBoolean('memory:list', 'opts.keysOnly', opts.keysOnly);
        }
      }
      const keysOnly = opts?.keysOnly === true;
      if (scope === 'global') {
        const content = await readGlobalMetaRules();
        const ref = await getGlobalMemoryLastReference();
        const entry: MemoryEntry = {
          scope,
          key: GLOBAL_MEMORY_KEY,
          content,
          updatedAt: Date.now()
        };
        return [withLastReference(entry, ref)];
      }
      const notes = await listWorkspaceNotes(undefined, keysOnly);
      const wsId = await activeWorkspaceId();
      const refs = wsId ? await listMemoryLastReferences(wsId) : {};
      return notes
        .filter((n) => !isPerConversationRunProgressKey(n.key))
        .map<MemoryEntry>((n) =>
        withLastReference(
          {
            scope: 'workspace',
            key: n.key,
            content: n.content,
            updatedAt: n.updatedAt
          },
          refs[n.key] ?? null
        )
      );
    }
  );

  wrapIpcHandler(IPC.MEMORY_READ, async (_event, scope: 'global' | 'workspace', key: string) => {
    assertEnum('memory:read', 'scope', scope, MEMORY_SCOPES);
    assertString('memory:read', 'key', key);
    if (scope === 'global' && key !== 'meta-rules.md' && key !== 'meta-rules') {
      throw new Error(
        'memory:read: global scope only supports key "meta-rules.md" (meta-rules)'
      );
    }
    if (scope === 'global') {
      const content = await readGlobalMetaRules();
      const entry: MemoryEntry = { scope, key, content, updatedAt: Date.now() };
      const ref = await getGlobalMemoryLastReference();
      return withLastReference(entry, ref);
    }
    const note = await readWorkspaceNote(key);
    if (!note) return null;
    const wsId = await activeWorkspaceId();
    const ref = wsId ? await getMemoryLastReference(wsId, note.key) : null;
    return withLastReference(
      { scope, key: note.key, content: note.content, updatedAt: note.updatedAt },
      ref
    );
  });

  wrapIpcHandler(
    IPC.MEMORY_WRITE,
    async (
      _event,
      scope: 'global' | 'workspace',
      key: string,
      content: string,
      // F-022: dedicated `mode` arg replaces the prior `key === 'append'`
      // magic-key sentinel. Defaults to `'set'` so existing callers
      // (the renderer's MemoryPanel save / new-entry flows) keep
      // overwrite semantics. The legacy `key === 'append'` path is
      // retained as a back-compat shim — it is still honored when the
      // explicit `mode` is omitted, so any out-of-tree caller pinned
      // to the old shape doesn't break, but new code should pass
      // `mode: 'append'` and use a real key.
      mode?: 'set' | 'append',
      conversationId?: string
    ) => {
      assertEnum('memory:write', 'scope', scope, MEMORY_SCOPES);
      assertString('memory:write', 'key', key);
      // `content` can be empty (user clearing a note), so disable the
      // nonEmpty default. Cap to prevent a malformed call from
      // pinning the atomic-write path on a multi-MB payload.
      assertString('memory:write', 'content', content, {
        nonEmpty: false,
        maxBytes: MAX_MEMORY_CONTENT_BYTES
      });
      if (mode !== undefined) {
        assertEnum('memory:write', 'mode', mode, MEMORY_WRITE_MODES);
      }
      if (conversationId !== undefined) {
        assertString('memory:write', 'conversationId', conversationId);
      }
      const isAppend = mode === 'append' || (mode === undefined && key === 'append');
      if (scope === 'workspace' && isAppend) {
        throw new Error(
          'memory:write append mode is not supported for workspace notes — use set (overwrite) instead.'
        );
      }
      if (scope === 'global') {
        if (isAppend) {
          await appendGlobalMetaRule(content);
        } else {
          await writeGlobalMetaRules(content);
        }
        const updated = await readGlobalMetaRules();
        let entry: MemoryEntry = {
          scope,
          key: GLOBAL_MEMORY_KEY,
          content: updated,
          updatedAt: Date.now()
        };
        if (conversationId) {
          const ref = await touchGlobalMemoryLastReference(conversationId);
          entry = withLastReference(entry, ref);
        } else {
          entry = withLastReference(entry, await getGlobalMemoryLastReference());
        }
        return entry;
      }
      const note = await writeWorkspaceNote(key, content);
      const ws = await getActiveWorkspace();
      if (ws) scheduleWorkspaceVectorIndex(ws.path);
      let entry: MemoryEntry = {
        scope,
        key: note.key,
        content: note.content,
        updatedAt: note.updatedAt
      };
      const wsId = await activeWorkspaceId();
      if (wsId && conversationId) {
        const ref = await touchMemoryLastReference(wsId, note.key, conversationId);
        entry = withLastReference(entry, ref);
      } else if (wsId) {
        entry = withLastReference(entry, await getMemoryLastReference(wsId, note.key));
      }
      return entry;
    }
  );

  // Reveal the underlying file in the OS file manager. We resolve the
  // path defensively (workspace scope can throw if no workspace is
  // bound, and the file may not exist yet for global scope until
  // `readGlobalMetaRules` has been called once).
  wrapIpcHandler(
    IPC.MEMORY_REVEAL,
    async (_event, scope: 'global' | 'workspace', key: string) => {
      assertEnum('memory:reveal', 'scope', scope, MEMORY_SCOPES);
      assertString('memory:reveal', 'key', key);
      let file: string | null;
      if (scope === 'global') {
        // Trigger the seed write if missing so `showItemInFolder` has a
        // real target. The renderer only exposes this action after it
        // has loaded the entry, so the file usually exists already —
        // but we double-check to keep the action dependable.
        await readGlobalMetaRules();
        file = globalMetaFilePath();
      } else {
        file = await workspaceNotePath(key);
      }
      if (!file) {
        throw new Error('No workspace bound — cannot reveal workspace note.');
      }
      try {
        await fs.access(file);
      } catch {
        throw new Error(`Memory file not found on disk: ${file}`);
      }
      shell.showItemInFolder(file);
    }
  );
}
