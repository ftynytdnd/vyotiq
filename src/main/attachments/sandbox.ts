/**
 * Attachments-root path containment. External attachment copies live under
 * `<userData>/vyotiq/attachments/`; preview + read IPC must stay inside that tree.
 */

import { resolve, relative, isAbsolute } from 'node:path';
import { promises as fs } from 'node:fs';
import { attachmentsRoot } from './ingest.js';
import { SandboxError } from '../tools/sandbox.js';

function resolveInsideRoot(root: string, p: string): string {
  const canonicalRoot = resolve(root);
  const candidate = isAbsolute(p) ? resolve(p) : resolve(canonicalRoot, p);
  const rel = relative(canonicalRoot, candidate);
  if (rel.startsWith('..') || (isAbsolute(rel) && rel !== '')) {
    throw new SandboxError(
      `Path "${p}" escapes the attachments sandbox (resolved to ${candidate}).`
    );
  }
  return candidate;
}

/** Lexical containment under `attachmentsRoot()`. */
function resolveInsideAttachmentsRoot(p: string): string {
  return resolveInsideRoot(attachmentsRoot(), p);
}

/**
 * Real-path check under the attachments root (follows symlinks).
 * Used before read/preview IPC serves file bytes to the renderer.
 */
export async function realpathInsideAttachmentsRoot(p: string): Promise<string> {
  const lex = resolveInsideAttachmentsRoot(p);
  const realRoot = await fs.realpath(attachmentsRoot());
  const real = await fs.realpath(lex);
  const rel = relative(realRoot, real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new SandboxError(
      `Path "${p}" symlinks outside the attachments sandbox (resolved to ${real}).`
    );
  }
  return real;
}
