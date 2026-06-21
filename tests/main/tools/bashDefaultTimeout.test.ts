import { describe, expect, it } from 'vitest';
import {
  BASH_BUILD_TIMEOUT_MS,
  BASH_INSTALL_TIMEOUT_MS,
  BASH_TEST_TIMEOUT_MS,
  BASH_TIMEOUT_MS
} from '@shared/constants.js';
import {
  formatBashTimeoutHint,
  resolveBashDefaultTimeout
} from '@main/tools/bashDefaultTimeout.js';

describe('resolveBashDefaultTimeout', () => {
  it('keeps the 30 s default for ordinary commands', () => {
    expect(resolveBashDefaultTimeout('echo hello')).toEqual({
      timeoutMs: BASH_TIMEOUT_MS,
      isolated: false
    });
  });

  it('extends timeout for test and check commands', () => {
    expect(resolveBashDefaultTimeout('pnpm test')).toEqual({
      timeoutMs: BASH_TEST_TIMEOUT_MS,
      isolated: true,
      category: 'test'
    });
    expect(resolveBashDefaultTimeout('pnpm run vitest')).toMatchObject({
      timeoutMs: BASH_TEST_TIMEOUT_MS,
      category: 'test'
    });
    expect(resolveBashDefaultTimeout('npx vitest run')).toMatchObject({
      timeoutMs: BASH_TEST_TIMEOUT_MS,
      category: 'test'
    });
  });

  it('extends timeout for build commands', () => {
    expect(resolveBashDefaultTimeout('pnpm build')).toEqual({
      timeoutMs: BASH_BUILD_TIMEOUT_MS,
      isolated: true,
      category: 'build'
    });
    expect(resolveBashDefaultTimeout('cargo build --release')).toMatchObject({
      timeoutMs: BASH_BUILD_TIMEOUT_MS,
      category: 'build'
    });
  });

  it('extends timeout for install commands', () => {
    expect(resolveBashDefaultTimeout('pnpm install')).toEqual({
      timeoutMs: BASH_INSTALL_TIMEOUT_MS,
      isolated: true,
      category: 'install'
    });
    expect(resolveBashDefaultTimeout('npm ci')).toMatchObject({
      timeoutMs: BASH_INSTALL_TIMEOUT_MS,
      category: 'install'
    });
  });

  it('prefers install over test when both match', () => {
    expect(resolveBashDefaultTimeout('pnpm install && pnpm test')).toMatchObject({
      category: 'install'
    });
  });

  it('extends timeout and isolates recursive directory searches', () => {
    expect(resolveBashDefaultTimeout('Get-ChildItem -Recurse -Filter "*.ts"')).toEqual({
      timeoutMs: BASH_TEST_TIMEOUT_MS,
      isolated: true,
      category: 'search'
    });
    expect(resolveBashDefaultTimeout('rg -r pattern .')).toMatchObject({
      timeoutMs: BASH_TEST_TIMEOUT_MS,
      isolated: true,
      category: 'search'
    });
  });
});

describe('formatBashTimeoutHint', () => {
  it('warns against workspace escape retries on generic timeout', () => {
    expect(formatBashTimeoutHint(30_000)).toContain('Do not read or write outside the workspace');
  });

  it('mentions extended budgets for test commands', () => {
    expect(formatBashTimeoutHint(BASH_TEST_TIMEOUT_MS, 'test')).toContain(String(BASH_TEST_TIMEOUT_MS));
  });
});
