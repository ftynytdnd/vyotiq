import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCommitMessage,
  classifyDeterministicCommit,
  isLockfilePath
} from '../../../src/shared/git/deterministicCommitMessage.js';

describe('deterministicCommitMessage', () => {
  it('detects lockfile-only paths', () => {
    expect(classifyDeterministicCommit(['pnpm-lock.yaml'])).toBe('lockfile-only');
    expect(classifyDeterministicCommit(['apps/web/pnpm-lock.yaml', 'yarn.lock'])).toBe('lockfile-only');
    expect(classifyDeterministicCommit(['src/a.ts', 'pnpm-lock.yaml'])).toBeNull();
  });

  it('builds conventional lockfile message', () => {
    const msg = buildDeterministicCommitMessage('lockfile-only', ['pnpm-lock.yaml']);
    expect(msg).toMatch(/^chore: update lockfile/);
    expect(msg).toContain('pnpm-lock.yaml');
  });

  it('detects binary-only paths', () => {
    expect(classifyDeterministicCommit(['assets/logo.png', 'public/icon.webp'])).toBe('binary-only');
    const msg = buildDeterministicCommitMessage('binary-only', ['assets/logo.png']);
    expect(msg).toMatch(/^chore\(assets\): add binary assets/);
  });

  it('identifies common lockfiles', () => {
    expect(isLockfilePath('package-lock.json')).toBe(true);
    expect(isLockfilePath('Cargo.lock')).toBe(true);
  });
});
