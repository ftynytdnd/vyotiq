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
 * Atomic write helper: writes payload to `${path}.tmp`, then renames to the
 * destination. A crash between writeFile + rename leaves the original file
 * intact (best case) or leaks a `.tmp` sibling (worst case — readable by a
 * future cleanup pass). Without this, `fs.writeFile` opens the target with
 * `O_TRUNC`, so a kernel-level interruption mid-write produces a truncated
 * settings.json / providers.json that the next `JSON.parse` rejects — and
 * the catch path silently downgrades to `{}`, wiping the user's entire
 * persisted state. Audit fix H-02 / M-02.
 *
 * The `.tmp` cleanup on failure is best-effort — a concurrent successful
 * write would have already replaced the target, and a stale `.tmp` is
 * harmless.
 */
async function atomicWrite(absPath: string, data: string | Buffer): Promise<void> {
  const tmp = `${absPath}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, absPath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* noop — tmp may not exist */
    }
    throw err;
  }
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
  await atomicWrite(userDataPath(filename), buf);
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

/** Plain-JSON helpers for non-secret state (e.g. settings.json).
 *
 * Atomic write via `${path}.tmp` + rename. Same crash-safety contract as
 * `writeEncryptedJson` above. Audit fix H-02 / M-02. */
export async function writePlainJson(filename: string, data: unknown): Promise<void> {
  await ensureUserDataDir();
  await atomicWrite(userDataPath(filename), JSON.stringify(data, null, 2));
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
