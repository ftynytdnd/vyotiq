/**
 * Default bash timeouts for slow-but-finite commands (tests, builds, installs).
 *
 * Models often omit `timeoutMs`; without these defaults, `pnpm test` and
 * similar invocations hit the 30 s cap and the agent retries with escape
 * paths (`$env:USERPROFILE`, absolute paths) that the sandbox blocks.
 */

import {
  BASH_BUILD_TIMEOUT_MS,
  BASH_INSTALL_TIMEOUT_MS,
  BASH_TEST_TIMEOUT_MS,
  BASH_TIMEOUT_MS
} from '@shared/constants.js';

export interface BashDefaultTimeout {
  timeoutMs: number;
  /** Prefer an isolated shell so long test/build runs do not block the shared PTY. */
  isolated: boolean;
  category?: 'test' | 'build' | 'install';
}

const INSTALL_RE =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:install|ci|i(?:\s|$)|add|remove|update)\b/i;

const BUILD_RE =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:build|compile|package|dist|bundle)\b/i;

const NATIVE_BUILD_RE = /\b(?:cargo\s+build|go\s+build|tsc(?:\s|$|-))/i;

const TEST_RE =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|check|lint|typecheck|type-check)\b/i;

const OTHER_TEST_RE = /\b(?:npx\s+(?:vitest|jest)|cargo\s+(?:test|check)|go\s+test|pytest)\b/i;

/**
 * Resolve the default timeout when the model omits `timeoutMs`.
 * Explicit overrides from the model are applied by the caller.
 */
export function resolveBashDefaultTimeout(command: string): BashDefaultTimeout {
  const c = command.trim();
  if (!c) {
    return { timeoutMs: BASH_TIMEOUT_MS, isolated: false };
  }
  if (INSTALL_RE.test(c)) {
    return { timeoutMs: BASH_INSTALL_TIMEOUT_MS, isolated: true, category: 'install' };
  }
  if (BUILD_RE.test(c) || NATIVE_BUILD_RE.test(c)) {
    return { timeoutMs: BASH_BUILD_TIMEOUT_MS, isolated: true, category: 'build' };
  }
  if (TEST_RE.test(c) || OTHER_TEST_RE.test(c)) {
    return { timeoutMs: BASH_TEST_TIMEOUT_MS, isolated: true, category: 'test' };
  }
  return { timeoutMs: BASH_TIMEOUT_MS, isolated: false };
}

/** Actionable hint appended to timeout errors. */
export function formatBashTimeoutHint(
  timeoutMs: number,
  category?: BashDefaultTimeout['category']
): string {
  if (category === 'install') {
    return (
      `Command timed out after ${timeoutMs} ms. Package installs can be slow — retry with ` +
      `timeoutMs up to ${BASH_INSTALL_TIMEOUT_MS} and shared:false if needed.`
    );
  }
  if (category === 'build') {
    return (
      `Command timed out after ${timeoutMs} ms. Builds can exceed the default budget — retry with ` +
      `timeoutMs up to ${BASH_BUILD_TIMEOUT_MS} and shared:false if needed.`
    );
  }
  if (category === 'test') {
    return (
      `Command timed out after ${timeoutMs} ms. Tests and checks often need more than 30 s — retry with ` +
      `timeoutMs up to ${BASH_TEST_TIMEOUT_MS} (or higher, max 30 min) and shared:false.`
    );
  }
  return (
    `Command timed out after ${timeoutMs} ms. For slow build/test/install work, retry with a higher ` +
    'timeoutMs (up to 30 min) and shared:false. Do not read or write outside the workspace to debug.'
  );
}
