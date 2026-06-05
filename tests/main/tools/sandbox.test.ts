/**
 * Tests for `sandbox.ts` — the workspace containment guard.
 *
 * Lexical containment, real-path containment (creating a real symlink
 * on disk), and the destructive-command regex bank are all covered
 * here. The destructive list especially benefits from regression tests
 * because Phase-1 hardening tightened those patterns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import {
  bashNeedsEscapeConfirm,
  hasEnvPathEscape,
  isDestructiveCommand,
  isInsideWorkspace,
  findSymlinksEscapingWorkspace,
  realpathInsideWorkspace,
  resolveCreateInsideWorkspace,
  resolveInsideWorkspace,
  SandboxError,
  workspaceRelative
} from '@main/tools/sandbox';

describe('resolveInsideWorkspace', () => {
  const root = sep === '\\' ? 'C:\\workspace' : '/workspace';

  it('resolves a relative path inside the root', () => {
    const out = resolveInsideWorkspace(root, 'src/index.ts');
    expect(out.startsWith(root)).toBe(true);
    expect(out.endsWith('index.ts')).toBe(true);
  });

  it('accepts an absolute path that is inside the root', () => {
    const inside = join(root, 'src', 'a.ts');
    expect(resolveInsideWorkspace(root, inside)).toBe(inside);
  });

  it('rejects ../ traversal', () => {
    expect(() => resolveInsideWorkspace(root, '../etc/passwd')).toThrow(SandboxError);
  });

  it('rejects an absolute path that is outside the root', () => {
    const outside = sep === '\\' ? 'C:\\elsewhere\\f.txt' : '/elsewhere/f.txt';
    expect(() => resolveInsideWorkspace(root, outside)).toThrow(SandboxError);
  });

  it('throws when no workspace is configured', () => {
    expect(() => resolveInsideWorkspace('', 'a.ts')).toThrow(/No workspace root/);
  });
});

describe('isInsideWorkspace', () => {
  const root = sep === '\\' ? 'C:\\workspace' : '/workspace';

  it('returns true for safe paths', () => {
    expect(isInsideWorkspace(root, 'a/b.ts')).toBe(true);
  });

  it('returns false for escapes', () => {
    expect(isInsideWorkspace(root, '../etc')).toBe(false);
  });

  it('returns false when no workspace is set', () => {
    expect(isInsideWorkspace('', 'a.ts')).toBe(false);
  });
});

describe('workspaceRelative', () => {
  const root = sep === '\\' ? 'C:\\workspace' : '/workspace';

  it('produces forward-slash output even on Windows', () => {
    const rel = workspaceRelative(root, join(root, 'src', 'a.ts'));
    expect(rel).toBe('src/a.ts');
  });

  it('returns "." for the root itself', () => {
    expect(workspaceRelative(root, root)).toBe('.');
  });
});

describe('realpathInsideWorkspace (with disk)', () => {
  let workspace: string;
  let outside: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-sb-ws-'));
    outside = await mkdtemp(join(tmpdir(), 'vyotiq-sb-out-'));
    await mkdir(join(workspace, 'sub'), { recursive: true });
    await writeFile(join(workspace, 'sub', 'real.txt'), 'inside');
    await writeFile(join(outside, 'evil.txt'), 'outside');
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('accepts a real file inside the workspace', async () => {
    const resolved = await realpathInsideWorkspace(workspace, 'sub/real.txt');
    const content = await fs.readFile(resolved, 'utf8');
    expect(content).toBe('inside');
  });

  it('falls back to lexical resolution for non-existent paths (creation flow)', async () => {
    // ENOENT during realpath → return lexical path so `edit { create: true }` works.
    const resolved = await realpathInsideWorkspace(workspace, 'sub/new-file.txt');
    expect(resolved.endsWith('new-file.txt')).toBe(true);
  });

  it('rejects a symlink that points outside the workspace', async () => {
    const linkPath = join(workspace, 'escape');
    try {
      await symlink(join(outside, 'evil.txt'), linkPath);
    } catch (err: unknown) {
      // Windows often forbids symlink creation without admin; skip
      // gracefully so the suite stays green on developer machines.
      if ((err as NodeJS.ErrnoException)?.code === 'EPERM') return;
      throw err;
    }
    await expect(realpathInsideWorkspace(workspace, 'escape')).rejects.toThrow(
      SandboxError
    );
  });
});

describe('resolveCreateInsideWorkspace (symlinked-ancestor escape)', () => {
  let workspace: string;
  let outside: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-sb-create-ws-'));
    outside = await mkdtemp(join(tmpdir(), 'vyotiq-sb-create-out-'));
    await mkdir(join(workspace, 'real'), { recursive: true });
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('resolves a new file under an existing in-workspace directory', async () => {
    const resolved = await resolveCreateInsideWorkspace(workspace, 'real/new.txt');
    expect(resolved.endsWith('new.txt')).toBe(true);
  });

  it('resolves a new file whose parent directory does not yet exist', async () => {
    const resolved = await resolveCreateInsideWorkspace(
      workspace,
      'deep/nested/new.txt'
    );
    expect(resolved.endsWith('new.txt')).toBe(true);
  });

  it('rejects a new-file path whose parent segment is a symlink pointing OUT of the workspace', async () => {
    // Regression: `edit { create: true }` previously took the
    // lexical-only branch (`resolveInsideWorkspace`), which does NOT
    // follow symlinks. A malicious (or merely confused) agent could
    // then `create` through a pre-existing in-workspace symlink like
    // `vendor → /etc` and write to `/etc/passwd`. The new
    // `resolveCreateInsideWorkspace` walks up to the deepest existing
    // ancestor and real-paths it; that ancestor must stay inside the
    // real-path'd workspace root.
    const linkName = 'link-to-outside';
    const linkPath = join(workspace, linkName);
    try {
      await symlink(outside, linkPath);
    } catch (err: unknown) {
      // Windows often forbids symlink creation without admin; skip
      // gracefully so the suite stays green on developer machines.
      if ((err as NodeJS.ErrnoException)?.code === 'EPERM') return;
      throw err;
    }
    await expect(
      resolveCreateInsideWorkspace(workspace, `${linkName}/evil.txt`)
    ).rejects.toThrow(SandboxError);
  });
});

describe('isDestructiveCommand', () => {
  it.each([
    'rm -rf /',
    'rm -Rf /usr/local',
    'rimraf node_modules',
    'format c:',
    'diskpart',
    'mkfs.ext4 /dev/sda',
    'dd if=/dev/zero of=/dev/sda',
    'git reset --hard HEAD~1',
    'git clean -fdx',
    'git push --force origin main',
    'git push -f origin main',
    'git branch -D mainline',
    'shutdown -h now',
    'reboot',
    ':() { :|:& };:',
    'Del /f C:\\Users\\me',
    'Remove-Item -Recurse -Force ./vendor',
    'rd -Recurse ./tmp',
    'rmdir -Recurse ./tmp',
    'ri -Recurse ./tmp',
    // Workspace-root wipes (the bash tool cwd's into the workspace, so
    // these resolve INSIDE the sandbox — they MUST still be caught).
    // Regression for the destructive-pattern audit finding 1.4: previously
    // only absolute-root wipes were flagged, so `rm -rf .` slipped through.
    'rm -rf .',
    'rm -rf ./',
    'rm -rf ./src',
    'rm -rf *',
    'rm -rf .[^.]*',
    'rm -rf ..',
    'find . -delete',
    'find ./src -exec rm -rf {} +',
    // PowerShell pipeline variants that sidestep `-Recurse`.
    'Get-ChildItem -Recurse | Remove-Item -Force',
    'gci | ri -Force',
    // Audit fix 2026-12-P2-2 — out-of-workspace write-redirection.
    // `>` and `>>` to absolute paths must require confirmation;
    // `/tmp/…` and `/dev/null` are deliberately allowed (see
    // negative cases below).
    'echo malicious > /etc/hosts',
    'echo malicious >> /etc/passwd',
    'cat foo > /var/log/wtmp',
    'printf "" > C:\\Windows\\System32\\drivers\\etc\\hosts',
    // `tee` to absolute paths — same threat shape as the
    // redirection above, sudo or not.
    'echo x | sudo tee /etc/hosts',
    'echo x | tee /etc/hosts',
    'echo x | tee -a /etc/hosts',
    'echo x | tee C:\\Windows\\foo',
    // chmod / chown / icacls rooted at `/`.
    'chmod -R 777 /',
    'chown -R root:root /',
    'icacls / /T /grant Everyone:F',
    'rmdir /s /q .',
    'del /q /f /s *',
    'Format-Volume -DriveLetter D',
    'Clear-Disk -RemoveData',
    'Reset-Service -Name wuauserv -Force'
  ])('flags %s as destructive', (cmd) => {
    expect(isDestructiveCommand(cmd)).toBe(true);
  });

  it.each([
    'rm package-lock.json',
    'git status',
    'echo hello',
    'ls -la',
    'cat README.md',
    'Remove-Item ./tmp.txt',
    'Get-ChildItem',
    // Audit fix 2026-12-P2-2 — negative cases that the new patterns
    // MUST let through. `/tmp/…` and `/dev/null` are intentional
    // negative-lookahead carve-outs because they are the canonical
    // harmless redirect targets.
    'echo done > /tmp/log.txt',
    'echo done >> /tmp/log.txt',
    'noisy-command > /dev/null',
    'noisy-command 2>&1 > /dev/null',
    'echo x | tee -a /tmp/log',
    // File-scoped chmod must still pass — only the bare-root walk
    // variant is destructive.
    'chmod 644 ./src/main.ts',
    'chmod -R 755 ./dist'
  ])('does NOT flag %s', (cmd) => {
    expect(isDestructiveCommand(cmd)).toBe(false);
  });
});

describe('hasEnvPathEscape', () => {
  it.each([
    'cat $HOME/.ssh/id_rsa',
    'cat ${HOME}/.ssh/id_rsa',
    'Get-Content $env:USERPROFILE\\secret.txt',
    '${env:APPDATA}\\evil.txt',
    'type %USERPROFILE%\\secret.txt',
    'cat %LOCALAPPDATA%\\cache\\db',
    'head ~/.bashrc',
    'cd ~ && ls',
    'ls ~\\Documents',
    'cat $TMPDIR/outside.log',
    'echo x > $env:TEMP\\escape.txt'
  ])('detects %s', (cmd) => {
    expect(hasEnvPathEscape(cmd)).toBe(true);
  });

  it.each([
    'echo hello',
    'echo $USER',
    'echo $PATH',
    'echo $PWD',
    'npm install foo~1.2.3',
    'cat ./README.md'
  ])('does not detect %s', (cmd) => {
    expect(hasEnvPathEscape(cmd)).toBe(false);
  });
});

describe('bashNeedsEscapeConfirm', () => {
  it.each([
    'echo x > ../outside.txt',
    'echo x >> ..\\secret.log',
    'Set-Content ..\\escape.txt -Value x',
    'cat ../outside/secret.txt',
    'Get-Content ..\\secret.log',
    'cat C:\\Windows\\System32\\drivers\\etc\\hosts',
    'head /etc/passwd',
    'cat $HOME/.ssh/id_rsa',
    'Get-Content $env:USERPROFILE\\secret.txt',
    'type %USERPROFILE%\\secret.txt',
    'head ~/.bashrc'
  ])('flags %s', (cmd) => {
    expect(bashNeedsEscapeConfirm(cmd).needed).toBe(true);
  });

  it.each([
    'echo hello',
    'ls -la src',
    'cat README.md',
    'echo done > ./out.log',
    'echo $USER',
    'npm install foo~1.2.3',
    // Windows CMD switches must not be treated as absolute POSIX paths.
    'dir /s /b mcp.json',
    'dir /s /b *.ts',
    'findstr /s /i pattern *.md'
  ])('does not flag %s', (cmd) => {
    expect(bashNeedsEscapeConfirm(cmd).needed).toBe(false);
  });
});
