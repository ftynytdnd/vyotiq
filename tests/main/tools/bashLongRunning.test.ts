import { describe, expect, it } from 'vitest';
import { resolveBashLongRunning } from '@main/tools/bashLongRunning.js';
import { BASH_SERVER_START_TIMEOUT_MS } from '@shared/constants.js';

describe('resolveBashLongRunning', () => {
  it('rewrites bare ollama serve to a detached startup plan', () => {
    const plan = resolveBashLongRunning('ollama serve');
    expect(plan?.kind).toBe('rewrite');
    if (plan?.kind !== 'rewrite') return;
    expect(plan.isolated).toBe(true);
    expect(plan.timeoutMs).toBe(BASH_SERVER_START_TIMEOUT_MS);
    if (process.platform === 'win32') {
      expect(plan.command).toContain('Start-Process');
      expect(plan.command).toContain('WindowStyle Hidden');
      expect(plan.command).not.toContain('-NoNewWindow');
    } else {
      expect(plan.command).toContain('nohup ollama serve');
    }
  });

  it('rewrites Start-Process -NoNewWindow ollama serve (agent hang repro)', () => {
    const plan = resolveBashLongRunning(
      'Start-Process -NoNewWindow -FilePath "ollama.exe" -ArgumentList "serve"'
    );
    expect(plan?.kind).toBe('rewrite');
    if (plan?.kind !== 'rewrite') return;
    expect(plan.command).not.toMatch(/-NoNewWindow/i);
    expect(plan.command).toContain('WindowStyle Hidden');
    expect(plan.command).toContain('11434');
  });

  it('rewrites Start-Process -Wait server commands on Windows', () => {
    if (process.platform !== 'win32') return;
    const plan = resolveBashLongRunning(
      'Start-Process -FilePath "ollama.exe" -ArgumentList "serve" -Wait'
    );
    expect(plan?.kind).toBe('rewrite');
    if (plan?.kind !== 'rewrite') return;
    expect(plan.command).not.toMatch(/-Wait\b/i);
  });

  it('blocks npm run dev with actionable guidance', () => {
    const blocked = resolveBashLongRunning('npm run dev');
    expect(blocked?.kind).toBe('block');
    if (blocked?.kind !== 'block') return;
    expect(blocked.output).toContain('long-running server');
    expect(blocked.output).toContain('npm run dev');
  });

  it('returns null for ordinary short-lived commands', () => {
    expect(resolveBashLongRunning('git status')).toBeNull();
    expect(resolveBashLongRunning('curl -sf http://127.0.0.1:11434/api/tags')).toBeNull();
  });
});
