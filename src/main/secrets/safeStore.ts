/**
 * safeStorage wrapper. Encrypts secrets via the OS keychain (DPAPI on Windows,
 * Keychain on macOS, kwallet/libsecret on Linux). All persistence goes through
 * here — there is no plaintext fallback for keys.
 */

import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';

function userDataPath(file: string): string {
  return join(app.getPath('userData'), file);
}

async function ensureUserDataDir(): Promise<string> {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Encrypts an object as JSON and writes it to disk.
 * On systems without crypto support, throws — we never silently downgrade.
 */
export async function writeEncryptedJson(filename: string, data: unknown): Promise<void> {
  await ensureUserDataDir();
  const json = JSON.stringify(data);
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS encryption (safeStorage) is unavailable. Refusing to persist secrets in plaintext.'
    );
  }
  const buf = safeStorage.encryptString(json);
  await fs.writeFile(userDataPath(filename), buf);
}

/**
 * Reads + decrypts an object from disk. Returns null if the file does not
 * exist. Throws if the file exists but cannot be decrypted (corruption /
 * keychain change).
 */
export async function readEncryptedJson<T>(filename: string): Promise<T | null> {
  const path = userDataPath(filename);
  try {
    const buf = await fs.readFile(path);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable; cannot decrypt existing secrets.');
    }
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

/** Plain-JSON helpers for non-secret state (e.g. settings.json). */
export async function writePlainJson(filename: string, data: unknown): Promise<void> {
  await ensureUserDataDir();
  await fs.writeFile(userDataPath(filename), JSON.stringify(data, null, 2), 'utf8');
}

export async function readPlainJson<T>(filename: string): Promise<T | null> {
  const path = userDataPath(filename);
  try {
    const txt = await fs.readFile(path, 'utf8');
    return JSON.parse(txt) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}
