/**
 * Editor IPC — sandboxed read/write for the in-app workspace editor.
 */

import { promises as fs } from 'node:fs';
import { IPC, READ_MAX_BYTES } from '@shared/constants.js';
import type {
  EditorReadInput,
  EditorReadResult,
  EditorWriteInput,
  EditorWriteReply
} from '@shared/types/editor.js';
import { scheduleWorkspaceVectorIndex } from '../memory/vector/indexScheduler.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import {
  requireWorkspace,
  requireWorkspaceById
} from '../workspace/workspaceState.js';
import { decodeDiskTextBuffer, encodeDiskTextBody, probeBinaryText } from '../text/decodeDiskText.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertObject,
  assertOptionalString,
  assertString,
  assertNumber
} from './validate.js';

const log = logger.child('ipc/editor');

const MAX_RELATIVE_PATH_BYTES = 4096;
const MAX_WRITE_BYTES = READ_MAX_BYTES;

function resolveWorkspacePath(workspaceId: string | undefined): Promise<string> {
  return workspaceId ? requireWorkspaceById(workspaceId) : requireWorkspace();
}

async function resolveAbs(ws: string, relPath: string): Promise<string> {
  return realpathInsideWorkspace(ws, relPath);
}

export function registerEditorIpc(): void {
  wrapIpcHandler(IPC.EDITOR_READ, async (_event, input: EditorReadInput): Promise<EditorReadResult> => {
    assertObject('editor:read', 'input', input);
    assertString('editor:read', 'path', input.path, { maxBytes: MAX_RELATIVE_PATH_BYTES });
    assertOptionalString('editor:read', 'workspaceId', input.workspaceId);

    const ws = await resolveWorkspacePath(input.workspaceId);
    const abs = await resolveAbs(ws, input.path);
    const st = await fs.stat(abs);
    if (!st.isFile()) {
      throw new Error(`Not a file: ${input.path}`);
    }

    const truncated = st.size > READ_MAX_BYTES;
    const buf = await fs.readFile(abs);
    const slice = truncated ? buf.subarray(0, READ_MAX_BYTES) : buf;
    const binary = probeBinaryText(slice);
    if (!binary.ok) {
      throw new Error(`Refusing to open binary file: ${input.path} (${binary.detail})`);
    }
    const decoded = decodeDiskTextBuffer(slice);
    const content = decoded.body;

    return {
      content,
      mtimeMs: st.mtimeMs,
      truncated,
      eol: decoded.eol,
      encoding: decoded.encoding,
      utf8Bom: decoded.utf8Bom
    };
  });

  wrapIpcHandler(IPC.EDITOR_WRITE, async (_event, input: EditorWriteInput): Promise<EditorWriteReply> => {
    assertObject('editor:write', 'input', input);
    assertString('editor:write', 'path', input.path, { maxBytes: MAX_RELATIVE_PATH_BYTES });
    assertString('editor:write', 'content', input.content, { maxBytes: MAX_WRITE_BYTES });
    assertOptionalString('editor:write', 'workspaceId', input.workspaceId);
    if (input.expectedMtimeMs !== undefined) {
      assertNumber('editor:write', 'expectedMtimeMs', input.expectedMtimeMs, { min: 0 });
    }

    const ws = await resolveWorkspacePath(input.workspaceId);
    const abs = await resolveAbs(ws, input.path);

    if (input.expectedMtimeMs !== undefined) {
      try {
        const st = await fs.stat(abs);
        if (Math.floor(st.mtimeMs) !== Math.floor(input.expectedMtimeMs)) {
          return { ok: false, reason: 'conflict', mtimeMs: st.mtimeMs };
        }
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (code !== 'ENOENT') throw err;
      }
    }

    let diskMeta;
    try {
      const existing = await fs.readFile(abs);
      const binary = probeBinaryText(existing);
      if (!binary.ok) {
        throw new Error(`Refusing to write binary file: ${input.path}`);
      }
      diskMeta = decodeDiskTextBuffer(existing);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT') {
        diskMeta = decodeDiskTextBuffer(Buffer.from(input.content, 'utf8'));
      } else {
        throw err;
      }
    }

    const out = encodeDiskTextBody(input.content, diskMeta);
    await fs.writeFile(abs, out);
    const st = await fs.stat(abs);
    scheduleWorkspaceVectorIndex(ws);
    log.debug('editor write', { path: input.path, bytes: Buffer.byteLength(input.content, 'utf8') });
    return { ok: true, mtimeMs: st.mtimeMs };
  });
}
