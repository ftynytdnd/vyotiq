import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { clipboard, dialog, shell } from 'electron';
import { IPC, MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import {
  looksLikeAbsoluteFilePath,
  normalizeClipboardPath,
  parseFileUriList
} from '@shared/attachments/clipboardFilePaths.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertNumber, assertObject, assertOptionalString, assertString } from './validate.js';
import { collectFolderFiles } from '../attachments/collectFolderFiles.js';
import { ingestExternalFile, ingestExternalFiles, ingestBuffer, assertAttachmentCount } from '../attachments/ingest.js';
import { summarizeAttachmentRejections } from '@shared/attachments/summarizeAttachmentRejections.js';
import { notifyUiToast } from '../ui/uiToast.js';
import { resolveAttachmentInWorkspace } from '../attachments/resolveInWorkspace.js';
import { realpathInsideAttachmentsRoot } from '../attachments/sandbox.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';

const MAX_ATTACHMENT_IO_PATH_BYTES = 4096;

function notifyAttachmentIngestRejections(
  rejected: Array<{ name: string; reason: string }>,
  conversationId?: string
): void {
  const message = summarizeAttachmentRejections(rejected);
  if (!message) return;
  notifyUiToast({ message, variant: 'danger', ...(conversationId ? { conversationId } : {}) });
}

interface AttachmentPathInput {
  path: string;
  /** When set, `path` is workspace-relative and resolved via workspace sandbox. */
  workspaceId?: string;
}

function parseAttachmentPathInput(channel: string, input: unknown): AttachmentPathInput {
  if (typeof input === 'string') {
    assertString(channel, 'path', input, { maxBytes: MAX_ATTACHMENT_IO_PATH_BYTES });
    return { path: input };
  }
  assertObject(channel, 'input', input);
  assertString(channel, 'input.path', input.path, { maxBytes: MAX_ATTACHMENT_IO_PATH_BYTES });
  assertOptionalString(channel, 'input.workspaceId', input.workspaceId);
  return {
    path: input.path,
    workspaceId: input.workspaceId as string | undefined
  };
}

async function resolveAttachmentReadPath(input: AttachmentPathInput): Promise<string> {
  if (input.workspaceId) {
    const workspacePath = await requireWorkspaceById(input.workspaceId);
    return realpathInsideWorkspace(workspacePath, input.path);
  }
  return realpathInsideAttachmentsRoot(input.path);
}

async function ingestClipboardAttachments(
  _event: unknown,
  input: {
    workspaceId: string;
    conversationId: string;
    messageId: string;
    blobs?: Array<{ name: string; mimeType: string; data: Uint8Array }>;
  }
): Promise<PromptAttachmentMeta[]> {
  assertObject('attachments:ingestClipboard', 'input', input);
  assertString('attachments:ingestClipboard', 'workspaceId', input.workspaceId);
  assertString('attachments:ingestClipboard', 'conversationId', input.conversationId);
  assertString('attachments:ingestClipboard', 'messageId', input.messageId);
  await requireWorkspaceById(input.workspaceId);

  const out: PromptAttachmentMeta[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  const slots = () => MAX_CHAT_ATTACHMENTS - out.length;

  if (Array.isArray(input.blobs)) {
    for (const blob of input.blobs) {
      if (slots() <= 0) break;
      assertObject('attachments:ingestClipboard', 'blob', blob);
      assertString('attachments:ingestClipboard', 'blob.name', blob.name);
      assertString('attachments:ingestClipboard', 'blob.mimeType', blob.mimeType);
      if (!(blob.data instanceof Uint8Array) || blob.data.byteLength === 0) continue;
      try {
        out.push(
          await ingestBuffer({
            buffer: Buffer.from(blob.data),
            suggestedName: blob.name,
            mimeType: blob.mimeType,
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            messageId: input.messageId
          })
        );
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        rejected.push({ name: blob.name, reason });
      }
    }
  }

  if (out.length === 0) {
    const pathCandidates = new Set<string>();
    for (const p of parseFileUriList(clipboard.read('text/uri-list'))) {
      pathCandidates.add(p);
    }
    const textPath = clipboard.readText().trim();
    if (looksLikeAbsoluteFilePath(textPath)) {
      pathCandidates.add(normalizeClipboardPath(textPath));
    }
    const paths = [...pathCandidates].slice(0, MAX_CHAT_ATTACHMENTS);
    if (paths.length > 0) {
      const batch = await ingestExternalFiles(paths, {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        messageId: input.messageId
      });
      out.push(...batch.ingested.slice(0, MAX_CHAT_ATTACHMENTS));
      rejected.push(...batch.rejected);
    }
  }

  if (out.length === 0) {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const png = image.toPNG();
      try {
        out.push(
          await ingestBuffer({
            buffer: png,
            suggestedName: `clipboard-${Date.now()}.png`,
            mimeType: 'image/png',
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            messageId: input.messageId
          })
        );
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        rejected.push({ name: 'clipboard image', reason });
      }
    }
  }

  notifyAttachmentIngestRejections(rejected, input.conversationId);
  return out;
}

export function registerAttachmentsIpc(): void {
  wrapIpcHandler(
    IPC.ATTACHMENTS_PICK,
    async (
      _event,
      input: {
        workspaceId: string;
        conversationId: string;
        messageId: string;
        maxCount?: number;
      }
    ): Promise<PromptAttachmentMeta[]> => {
      assertObject('attachments:pick', 'input', input);
      assertString('attachments:pick', 'workspaceId', input.workspaceId);
      assertString('attachments:pick', 'conversationId', input.conversationId);
      assertString('attachments:pick', 'messageId', input.messageId);
      const max = input.maxCount ?? MAX_CHAT_ATTACHMENTS;
      assertNumber('attachments:pick', 'maxCount', max, { integer: true, min: 1, max: MAX_CHAT_ATTACHMENTS });

      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
      });
      if (result.canceled || result.filePaths.length === 0) return [];

      const paths = result.filePaths.slice(0, max);
      assertAttachmentCount(paths.length);

      await requireWorkspaceById(input.workspaceId);
      const { ingested, rejected } = await ingestExternalFiles(paths, {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        messageId: input.messageId
      });
      notifyAttachmentIngestRejections(rejected, input.conversationId);
      return ingested;
    }
  );

  wrapIpcHandler(
    IPC.ATTACHMENTS_COLLECT_FOLDER,
    async (
      _event,
      input: { workspaceId: string; folderPath: string; maxCount?: number }
    ): Promise<{ paths: string[]; total: number; truncated: boolean }> => {
      assertObject('attachments:collectFolder', 'input', input);
      assertString('attachments:collectFolder', 'workspaceId', input.workspaceId);
      assertString('attachments:collectFolder', 'folderPath', input.folderPath, {
        maxBytes: MAX_ATTACHMENT_IO_PATH_BYTES
      });
      const max = input.maxCount ?? MAX_CHAT_ATTACHMENTS;
      assertNumber('attachments:collectFolder', 'maxCount', max, {
        integer: true,
        min: 1,
        max: MAX_CHAT_ATTACHMENTS
      });
      const workspaceRoot = await requireWorkspaceById(input.workspaceId);
      return collectFolderFiles(workspaceRoot, input.folderPath, max);
    }
  );

  wrapIpcHandler(
    IPC.ATTACHMENTS_INGEST_PATHS,
    async (
      _event,
      input: {
        paths: string[];
        workspaceId: string;
        conversationId: string;
        messageId: string;
      }
    ): Promise<PromptAttachmentMeta[]> => {
      assertObject('attachments:ingest', 'input', input);
      assertString('attachments:ingest', 'workspaceId', input.workspaceId);
      assertString('attachments:ingest', 'conversationId', input.conversationId);
      assertString('attachments:ingest', 'messageId', input.messageId);
      if (!Array.isArray(input.paths)) {
        throw new Error('attachments:ingest: paths must be an array');
      }
      assertAttachmentCount(input.paths.length);
      const workspaceRoot = await requireWorkspaceById(input.workspaceId);
      const out: PromptAttachmentMeta[] = [];
      const rejected: Array<{ name: string; reason: string }> = [];
      for (const p of input.paths) {
        assertString('attachments:ingest', 'path', p, { maxBytes: MAX_ATTACHMENT_IO_PATH_BYTES });
        const ws = await resolveAttachmentInWorkspace(workspaceRoot, p);
        try {
          out.push(
            await ingestExternalFile({
              sourcePath: ws.inWorkspace ? ws.absPath : p,
              workspaceId: input.workspaceId,
              conversationId: input.conversationId,
              messageId: input.messageId,
              workspacePath: ws.inWorkspace ? ws.workspacePath : undefined
            })
          );
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          rejected.push({ name: p.split(/[/\\]/).pop() ?? p, reason });
        }
      }
      notifyAttachmentIngestRejections(rejected, input.conversationId);
      return out;
    }
  );

  wrapIpcHandler(
    IPC.ATTACHMENTS_INGEST_CLIPBOARD_IMAGE,
    async (
      _event,
      input: { workspaceId: string; conversationId: string; messageId: string }
    ): Promise<PromptAttachmentMeta | null> => {
      const batch = await ingestClipboardAttachments(_event, {
        ...input,
        blobs: undefined
      });
      return batch[0] ?? null;
    }
  );

  wrapIpcHandler(
    IPC.ATTACHMENTS_INGEST_CLIPBOARD,
    async (
      _event,
      input: {
        workspaceId: string;
        conversationId: string;
        messageId: string;
        blobs?: Array<{ name: string; mimeType: string; data: Uint8Array }>;
      }
    ): Promise<PromptAttachmentMeta[]> => ingestClipboardAttachments(_event, input)
  );

  wrapIpcHandler(IPC.ATTACHMENTS_READ_TEXT, async (_event, input: unknown): Promise<string> => {
    const wire = parseAttachmentPathInput('attachments:readText', input);
    const abs = await resolveAttachmentReadPath(wire);
    const buf = await readFile(abs, 'utf8');
    return buf.slice(0, 512 * 1024);
  });

  wrapIpcHandler(IPC.ATTACHMENTS_FILE_URL, async (_event, input: unknown): Promise<string> => {
    const wire = parseAttachmentPathInput('attachments:fileUrl', input);
    const abs = await resolveAttachmentReadPath(wire);
    return pathToFileURL(abs).href;
  });

  wrapIpcHandler(IPC.ATTACHMENTS_OPEN, async (_event, input: unknown): Promise<void> => {
    const wire = parseAttachmentPathInput('attachments:open', input);
    const abs = await resolveAttachmentReadPath(wire);
    const result = await shell.openPath(abs);
    if (result) {
      throw new Error(result);
    }
  });
}
