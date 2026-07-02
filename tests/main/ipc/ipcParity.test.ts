/**
 * IPC contract parity — preload invoke channels must have main handlers.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '@shared/constants.js';

const ROOT = join(process.cwd(), 'src');

function ipcKeyToChannel(key: string): string {
  return IPC[key as keyof typeof IPC];
}

function collectHandlerChannels(): Set<string> {
  const dir = join(ROOT, 'main/ipc');
  const channels = new Set<string>();
  const re = /wrapIpcHandler\(\s*IPC\.([A-Z0-9_]+)/g;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      channels.add(ipcKeyToChannel(match[1]!));
    }
  }
  return channels;
}

function collectPreloadInvokeChannels(): Set<string> {
  const text = readFileSync(join(ROOT, 'main/preload/preload.ts'), 'utf8');
  const channels = new Set<string>();
  const re = /ipcRenderer\.invoke\(\s*IPC\.([A-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    channels.add(ipcKeyToChannel(match[1]!));
  }
  return channels;
}

describe('IPC parity', () => {
  it('registers a main handler for every preload invoke channel', () => {
    const handlers = collectHandlerChannels();
    const preloadInvokes = collectPreloadInvokeChannels();
    const missing = [...preloadInvokes].filter((ch) => !handlers.has(ch)).sort();
    expect(missing, `missing handlers: ${missing.join(', ')}`).toEqual([]);
  });

  it('maps handler channels to IPC constants', () => {
    const handlers = collectHandlerChannels();
    for (const channel of handlers) {
      expect(Object.values(IPC)).toContain(channel);
    }
  });
});
