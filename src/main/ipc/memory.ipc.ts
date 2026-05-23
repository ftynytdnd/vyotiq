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
        const entry: MemoryEntry = {
          scope,
          key: 'meta-rules.md',
          content,
          updatedAt: Date.now()
        };
        return [entry];
      }
      const notes = await listWorkspaceNotes(undefined, keysOnly);
      return notes.map<MemoryEntry>((n) => ({
        scope: 'workspace',
        key: n.key,
        content: n.content,
        updatedAt: n.updatedAt
      }));
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
      return entry;
    }
    const note = await readWorkspaceNote(key);
    if (!note) return null;
    const entry: MemoryEntry = { scope, key: note.key, content: note.content, updatedAt: note.updatedAt };
    return entry;
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
      mode?: 'set' | 'append'
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
      if (scope === 'global') {
        const isAppend = mode === 'append' || (mode === undefined && key === 'append');
        if (isAppend) {
          await appendGlobalMetaRule(content);
        } else {
          await writeGlobalMetaRules(content);
        }
        const updated = await readGlobalMetaRules();
        const entry: MemoryEntry = {
          scope,
          key: 'meta-rules.md',
          content: updated,
          updatedAt: Date.now()
        };
        return entry;
      }
      // Workspace notes don't support append today (the editor is a
      // full textarea — there is no append affordance). Silently
      // accept `mode: 'append'` here as overwrite to keep the wire
      // shape symmetric across scopes; revisit if a workspace-note
      // append affordance ever lands.
      const note = await writeWorkspaceNote(key, content);
      const entry: MemoryEntry = {
        scope,
        key: note.key,
        content: note.content,
        updatedAt: note.updatedAt
      };
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
