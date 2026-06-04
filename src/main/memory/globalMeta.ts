/**
 * Global meta-rules store. Lives in `<userData>/meta-rules.md`. Loaded at boot
 * and injected into every system prompt as `<meta_rules>`. Agent V is allowed
 * (per harness) to append/rewrite it when the user issues persistent
 * corrections.
 */

import { app } from 'electron';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { GLOBAL_META_FILE } from '@shared/constants.js';

function metaPath(): string {
  return join(app.getPath('userData'), GLOBAL_META_FILE);
}

/**
 * Public accessor for the on-disk meta-rules file path. Used by the
 * Memory IPC's reveal-in-folder action; everything else should keep
 * going through the read/write API in this module so the seeding logic
 * stays centralized.
 */
export function globalMetaFilePath(): string {
  return metaPath();
}

const SEED = `# Vyotiq — Global Meta-Rules

This file persists user preferences and meta-rules learned across all
sessions. Agent V reads this on every boot. Lines starting with \`-\` are
treated as preferences. The agent may append to this file when the user
issues a persistent correction (e.g. "stop using X, I prefer Y").

## Preferences
- (none yet — Agent V will append corrections here)
`;

export async function readGlobalMetaRules(): Promise<string> {
  try {
    return await fs.readFile(metaPath(), 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await fs.writeFile(metaPath(), SEED, 'utf8');
      return SEED;
    }
    throw err;
  }
}

export async function writeGlobalMetaRules(content: string): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(metaPath(), content, 'utf8');
}

/**
 * Serialization queue for the meta-rules file. `appendGlobalMetaRule` is
 * read-modify-write (read full file → append bullet → rewrite), which
 * races when two callers run it concurrently — e.g. two sub-agents (the
 * pool runs up to `DEFAULT_DELEGATE_CONCURRENCY` at once) that both emit a
 * `memory.action: 'append'` against the same target. Without a mutex,
 * the second write clobbers the first and its rule is silently lost.
 *
 * We chain every append onto a single process-wide promise so the
 * read-modify-write sequence executes atomically per call. The chain's
 * `.catch(() => undefined)` ensures one failing append can't poison the
 * queue for subsequent callers — each call still awaits its own result
 * and will surface its own error to the caller.
 */
let appendChain: Promise<void> = Promise.resolve();

export async function appendGlobalMetaRule(line: string): Promise<void> {
  const next = appendChain.then(async () => {
    const current = await readGlobalMetaRules();
    const stamped = `- [${new Date().toISOString().slice(0, 10)}] ${line.trim()}`;
    await writeGlobalMetaRules(current.trimEnd() + '\n' + stamped + '\n');
  });
  // Prevent a rejected append from poisoning the queue for later callers.
  appendChain = next.catch(() => undefined);
  await next;
}
