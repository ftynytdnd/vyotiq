/**
 * Phase 2.6 — bash-write detector.
 *
 * Pins:
 *   1. Heredoc (quoted + unquoted tag + `<<-` tab-strip) extracts
 *      the body between the opener and the closing tag.
 *   2. Streaming mid-heredoc (no closing tag yet) still returns a
 *      partial body with `complete: false`.
 *   3. `echo` with single-quoted / double-quoted / `-n` flag
 *      variants parses correctly; variable expansion (`$foo`) is
 *      refused.
 *   4. `printf` single-arg + `%s` two-arg forms parse; other format
 *      specifiers are refused to avoid false positives.
 *   5. Compound operators (`&&`, `||`, `;`, `|`, literal `\n`) in
 *      the redirection prefix reject the whole command — we can't
 *      tell which side writes.
 *   6. Glob / command-substitution / variable paths are rejected.
 *   7. `>>` (append) is rejected — the streamer only handles full
 *      replacements.
 */

import { describe, expect, it } from 'vitest';
import { tryParseBashWrite } from '@main/orchestrator/bashWriteParser';

describe('tryParseBashWrite', () => {
  describe('heredoc', () => {
    it('parses a simple cat heredoc with unquoted tag', () => {
      const cmd = `cat > foo.ts << EOF\nhello\nworld\nEOF`;
      const op = tryParseBashWrite(cmd);
      expect(op).toEqual({
        filePath: 'foo.ts',
        newContent: 'hello\nworld\n',
        complete: true
      });
    });

    it('parses a quoted-tag heredoc', () => {
      const cmd = `cat > foo.ts << 'EOF'\nhello\nEOF`;
      const op = tryParseBashWrite(cmd);
      expect(op?.filePath).toBe('foo.ts');
      expect(op?.newContent).toBe('hello\n');
      expect(op?.complete).toBe(true);
    });

    it('returns a partial body when the closing tag has not arrived yet', () => {
      const cmd = `cat > foo.ts << EOF\nline one\nline tw`;
      const op = tryParseBashWrite(cmd);
      expect(op?.filePath).toBe('foo.ts');
      expect(op?.newContent).toBe('line one\nline tw');
      expect(op?.complete).toBe(false);
    });

    it('strips leading tabs on <<- heredoc', () => {
      const cmd = `cat > foo.ts <<- EOF\n\t\tindented\n\tline\n\tEOF`;
      const op = tryParseBashWrite(cmd);
      expect(op?.newContent).toBe('indented\nline\n');
      expect(op?.complete).toBe(true);
    });

    it('rejects tee heredoc without an explicit > — ambiguous w/o a flag', () => {
      // `tee foo.ts << EOF` writes to both stdout AND foo.ts, but
      // we're strict about requiring an explicit `>` redirection
      // to keep the parser's false-positive rate at zero. The
      // renderer's synthesised preview still paints the change.
      const cmd = `tee foo.ts << EOF\nbody\nEOF`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('rejects tee -a (append mode)', () => {
      const cmd = `tee -a foo.ts << EOF\nbody\nEOF`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('rejects >> (append) heredoc', () => {
      const cmd = `cat >> foo.ts << EOF\nbody\nEOF`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('rejects heredoc into a glob path', () => {
      const cmd = `cat > *.ts << EOF\nbody\nEOF`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('rejects heredoc where the path contains $()', () => {
      const cmd = `cat > $(pwd)/foo.ts << EOF\nbody\nEOF`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('rejects heredoc with a compound operator before the redirection', () => {
      const cmd = `rm -f foo.ts && cat > foo.ts << EOF\nbody\nEOF`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('matches heredoc on an absolute path', () => {
      const cmd = `cat > /tmp/foo.ts << EOF\nhi\nEOF`;
      const op = tryParseBashWrite(cmd);
      expect(op?.filePath).toBe('/tmp/foo.ts');
    });
  });

  describe('echo', () => {
    it('parses single-quoted echo redirection with a trailing newline', () => {
      const cmd = `echo 'hello world' > foo.txt`;
      const op = tryParseBashWrite(cmd);
      expect(op).toEqual({
        filePath: 'foo.txt',
        newContent: 'hello world\n',
        complete: true
      });
    });

    it('parses double-quoted echo and processes simple escapes', () => {
      const cmd = `echo "line1\\nline2" > foo.txt`;
      const op = tryParseBashWrite(cmd);
      expect(op?.newContent).toBe('line1\nline2\n');
    });

    it('drops the trailing newline with echo -n', () => {
      const cmd = `echo -n 'no newline' > foo.txt`;
      const op = tryParseBashWrite(cmd);
      expect(op?.newContent).toBe('no newline');
    });

    it('rejects echo of a double-quoted string with $var', () => {
      const cmd = `echo "hello $USER" > foo.txt`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('rejects echo with a trailing extra token', () => {
      // `echo 'a' 'b' > foo.txt` would word-split into "a b", which
      // we don't model safely.
      const cmd = `echo 'a' 'b' > foo.txt`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });
  });

  describe('printf', () => {
    it('parses single-arg single-quoted printf', () => {
      const cmd = `printf 'hello' > foo.txt`;
      const op = tryParseBashWrite(cmd);
      expect(op).toEqual({
        filePath: 'foo.txt',
        newContent: 'hello',
        complete: true
      });
    });

    it('parses the canonical printf %s form', () => {
      const cmd = `printf '%s' 'body content' > foo.txt`;
      const op = tryParseBashWrite(cmd);
      expect(op?.newContent).toBe('body content');
    });

    it('rejects printf with a non-%s format', () => {
      const cmd = `printf '%d' '42' > foo.txt`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('rejects printf double-quoted body with $var', () => {
      const cmd = `printf "hello $USER" > foo.txt`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });
  });

  describe('negative cases', () => {
    it('returns null for an empty string', () => {
      expect(tryParseBashWrite('')).toBeNull();
    });

    it('returns null for a non-string input', () => {
      expect(tryParseBashWrite(null as unknown as string)).toBeNull();
    });

    it('returns null for a command without any > redirection', () => {
      expect(tryParseBashWrite('ls -la')).toBeNull();
      expect(tryParseBashWrite('cat foo.txt')).toBeNull();
    });

    it('returns null for pipes even if they end in a write', () => {
      // `cat foo.txt | tee bar.txt` — source unclear for preview.
      const cmd = `cat foo.txt | tee bar.txt`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });

    it('returns null for a semicolon-chained command', () => {
      const cmd = `echo 'a' > foo.txt; echo 'b' > foo.txt`;
      expect(tryParseBashWrite(cmd)).toBeNull();
    });
  });
});
