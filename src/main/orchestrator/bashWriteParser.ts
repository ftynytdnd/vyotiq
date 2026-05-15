/**
 * Best-effort detection of a `bash` tool call that writes the
 * entire content of a file. Used by the live diff streamer to
 * surface a streaming preview for the common write patterns the
 * model uses outside of the structured `edit` tool:
 *
 *   - `cat > path << 'EOF'\n...\nEOF`     (heredoc, quoted tag)
 *   - `cat > path << EOF\n...\nEOF`       (heredoc, unquoted tag)
 *   - `cat > path <<-'EOF'\n...\nEOF`     (heredoc, leading-tab strip)
 *   - `echo 'text' > path`                (single-arg echo)
 *   - `echo "text" > path`                (double-quoted)
 *   - `printf '%s' 'text' > path`         (printf with format string)
 *   - `printf 'text' > path`              (printf no fmt)
 *
 * The parser is INTENTIONALLY conservative — false positives would
 * produce a wrong diff preview, which is worse than no preview. So:
 *
 *   - Only literal redirections to a single fixed path are matched
 *     (no glob, no command substitution in the path).
 *   - Compound commands chained with `;`, `&&`, `||`, `|` are
 *     rejected: we can't tell which side actually writes.
 *   - The path must be syntactically a relative or single-segment
 *     absolute path; attempts to escape with `$()` etc. are dropped.
 *
 * The output is a `{ filePath, newContent }` pair — the same shape
 * `DiffStreamer` already understands for the `edit` (full-file
 * replacement) case, so wiring is one branch in `onArgsDelta`.
 *
 * During streaming, the `command` string may end mid-heredoc (no
 * closing tag yet). The parser still returns the partial body in
 * that case so the streamer can emit progressive `diff-stream`
 * events; the final emit on settle reconciles to the authoritative
 * tool-call body.
 */

export interface BashWriteOp {
  /** Workspace-relative or absolute path the redirection targets. */
  filePath: string;
  /** Body that will be written; may be partial during streaming. */
  newContent: string;
  /** True when the parser saw a complete terminator (closing `EOF`,
   * end-of-string for echo/printf). False during streaming when the
   * heredoc is still open. */
  complete: boolean;
}

/**
 * Reject commands that include compound operators outside of the
 * heredoc body. We split on top-level `;`, `&&`, `||`, `|` and
 * `\n` (where the newline is NOT inside a heredoc).
 *
 * For simplicity we reject any of these tokens that appear OUTSIDE
 * a heredoc body. Implementation-wise we look at the prefix of the
 * command up to the first `<<` heredoc opener (if any) — that's
 * the part that gets parsed as redirection structure.
 */
function hasCompoundOperator(prefix: string): boolean {
  // We only care about the redirection scaffolding before the
  // optional heredoc body. Strip quoted strings first so a `&&`
  // inside `'string'` doesn't false-positive.
  const stripped = prefix.replace(/'[^']*'|"[^"]*"/g, '');
  return /(?:&&|\|\||;|\||\n)/.test(stripped);
}

/**
 * Validate that `path` is a plain literal — no command substitution
 * (`$()`, backticks), no glob (`*`, `?`), no variable expansion
 * (`${...}` is conservatively rejected because the streamer can't
 * resolve it).
 */
function isLiteralPath(path: string): boolean {
  if (path.length === 0) return false;
  if (/[\s'"`]/.test(path)) return false;
  if (path.includes('$(') || path.includes('`')) return false;
  if (path.includes('${') || path.includes('$')) return false;
  if (path.includes('*') || path.includes('?')) return false;
  return true;
}

/**
 * Strip a single layer of surrounding quotes (single OR double).
 */
function unquote(s: string): string {
  if (s.length >= 2 && (s[0] === "'" || s[0] === '"') && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Bash echo accepts unquoted tokens too — but supporting that
 * faithfully (with full word-splitting + quoting rules) is way out
 * of scope. We only handle the single-quoted-arg case (most common
 * in code-emitting models) and the trivial unquoted single-token
 * case.
 */
function parseEchoArg(args: string): string | null {
  const trimmed = args.trim();
  // `echo -n` / `echo -e` flag is allowed; strip leading flag tokens.
  let body = trimmed;
  while (/^-[neE]+(\s|$)/.test(body)) {
    body = body.replace(/^-[neE]+\s*/, '');
  }
  if (body.length === 0) return '';
  // Single-quoted: literal, no escape processing inside.
  if (body[0] === "'") {
    const close = body.indexOf("'", 1);
    if (close === -1) return null;
    // Reject anything trailing — `echo 'foo' bar` would word-split,
    // which we don't model.
    if (body.slice(close + 1).trim().length > 0) return null;
    return body.slice(1, close);
  }
  // Double-quoted: process the most common escapes (\n, \t, \\, \").
  // Anything else (e.g. `$var`) is a sign of variable expansion and
  // we bail out — we can't resolve it.
  if (body[0] === '"') {
    const close = body.indexOf('"', 1);
    if (close === -1) return null;
    if (body.slice(close + 1).trim().length > 0) return null;
    const raw = body.slice(1, close);
    if (raw.includes('$') || raw.includes('`')) return null;
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  // Unquoted single token: only safe if it has no whitespace.
  if (/\s/.test(body)) return null;
  if (body.includes('$') || body.includes('`')) return null;
  return body;
}

/**
 * Match `echo [flags] STRING > path` — also accepts `>>` as
 * append, but for the streamer we only emit a meaningful diff for
 * full-replacement (`>`) since append needs the existing body to
 * be preserved (which is what `edit` semantics already encode).
 * We include `>>` parsing too and surface it via a separate field
 * so future callers can distinguish; the streamer skips append for
 * now.
 *
 * Returns the redirection plus the text body; the caller decides
 * whether to use it.
 */
function matchEchoRedirection(command: string): BashWriteOp | null {
  const m = /^\s*echo\b(.*?)\s+(>{1,2})\s+(\S+)\s*$/s.exec(command);
  if (!m) return null;
  const redir = m[2]!;
  if (redir !== '>') return null; // append (>>) — skip for now
  const path = unquote(m[3]!);
  if (!isLiteralPath(path)) return null;
  if (hasCompoundOperator(m[1]!)) return null;
  const text = parseEchoArg(m[1]!);
  if (text === null) return null;
  // `echo` adds a trailing newline by default unless `-n` was given.
  const trailingNewline = !/^-[neE]*n[neE]*\b/.test(m[1]!.trim());
  return {
    filePath: path,
    newContent: trailingNewline ? text + '\n' : text,
    complete: true
  };
}

/**
 * Match `printf 'fmt' ['arg'] > path`. Only the simplest form is
 * recognised: a single literal format string with no `%` expansion
 * (callers that legitimately want a template aren't writing a file
 * with predictable bytes anyway).
 */
function matchPrintfRedirection(command: string): BashWriteOp | null {
  const m = /^\s*printf\b(.*?)\s+(>{1,2})\s+(\S+)\s*$/s.exec(command);
  if (!m) return null;
  if (m[2] !== '>') return null;
  const path = unquote(m[3]!);
  if (!isLiteralPath(path)) return null;
  if (hasCompoundOperator(m[1]!)) return null;
  const args = m[1]!.trim();
  // Two supported shapes:
  //   printf '%s' 'text'      — format + body
  //   printf 'text'           — body only
  const fmtMatch = /^'([^']*)'(?:\s+'([^']*)')?$/.exec(args);
  if (!fmtMatch) {
    // Try double-quoted bodies in the no-expansion case.
    const dqMatch = /^"([^"]*)"(?:\s+"([^"]*)")?$/.exec(args);
    if (!dqMatch) return null;
    if (dqMatch[1]!.includes('$') || dqMatch[1]!.includes('`')) return null;
    if (dqMatch[2] && (dqMatch[2].includes('$') || dqMatch[2].includes('`'))) {
      return null;
    }
    if (dqMatch[2] !== undefined) {
      if (dqMatch[1] !== '%s') return null;
      return { filePath: path, newContent: dqMatch[2], complete: true };
    }
    return { filePath: path, newContent: dqMatch[1]!, complete: true };
  }
  if (fmtMatch[2] !== undefined) {
    // Two-arg form — format MUST be exactly `%s` for safe handling.
    if (fmtMatch[1] !== '%s') return null;
    return { filePath: path, newContent: fmtMatch[2]!, complete: true };
  }
  // Single-arg form — body is the literal first arg.
  return { filePath: path, newContent: fmtMatch[1]!, complete: true };
}

/**
 * Match a heredoc-fed write: `cat > path << ['-]?'?TAG'?\nbody\nTAG`.
 * Streaming-aware: if the closing TAG hasn't arrived yet, we still
 * return the partial body with `complete: false`.
 */
function matchHeredoc(command: string): BashWriteOp | null {
  // Header capture: command-name, redirection, path, optional `-`,
  // optional quoted/unquoted tag.
  // We accept the leading command being either `cat`, `tee`, or
  // an empty redirection (`> path << EOF` is also valid bash).
  // Tee with a flag like `-a` writes append, which we skip.
  //
  // Audit fix H7: the trailing `\n` after the tag is OPTIONAL. While
  // the model is streaming the command, the buffer routinely looks
  // like `cat > foo.py << 'EOF'` BEFORE the body's first newline
  // lands. The previous regex required `\n` after the tag and would
  // return null in that window, so the streaming preview had no
  // path / no body to show. Making the newline optional and
  // defaulting the body to '' lets the streamer emit an empty-body
  // preview (which the content-aware dedup absorbs harmlessly) and
  // upgrade to the real body the moment bytes arrive.
  // `[\t ]*` (NOT `\s*`) before the optional `\n` so `\s*` doesn't
  // greedily eat the body-opening newline, which would force the
  // optional group to fail and the whole regex to backtrack to a
  // no-match. The original (pre-H7) regex used `\s*\n` and relied on
  // backtracking to leave one `\n` for the literal — that no longer
  // works once the `\n` itself is optional.
  const headerRe =
    /^\s*(?:cat\s+|tee\s+(?:-[aeFiIp]+\s+)?)?\s*(>{1,2})\s+(\S+)\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\3[\t ]*(?:\n([\s\S]*))?$/;
  const m = headerRe.exec(command);
  if (!m) return null;
  const redir = m[1]!;
  if (redir !== '>') return null; // append (>>) — skip
  const path = unquote(m[2]!);
  if (!isLiteralPath(path)) return null;
  // Compound-operator check on the prefix BEFORE the heredoc body.
  const prefix = command.slice(0, m.index! + m[0]!.indexOf('<<'));
  if (hasCompoundOperator(prefix)) return null;
  const tag = m[4]!;
  const body = m[5] ?? '';
  // Look for a line that is exactly the tag (optionally indented if
  // the original used `<<-`, which strips leading TABS from the body
  // and the tag line). Use the simpler `<<` rule first; the tab-strip
  // mode adds a permissive leading-whitespace allowance for the tag
  // line.
  const stripTabs = /<<-/.test(command);
  const tagLineRe = stripTabs ? new RegExp(`^[\\t ]*${tag}\\s*$`, 'm') : new RegExp(`^${tag}\\s*$`, 'm');
  const tagMatch = tagLineRe.exec(body);
  if (!tagMatch) {
    // Streaming — terminator hasn't landed yet. Emit the partial body
    // verbatim. The streamer's content-aware dedup absorbs the
    // intermediate snapshots.
    return {
      filePath: path,
      newContent: stripTabs ? body.replace(/^\t+/gm, '') : body,
      complete: false
    };
  }
  const fullBody = body.slice(0, tagMatch.index);
  return {
    filePath: path,
    newContent: stripTabs ? fullBody.replace(/^\t+/gm, '') : fullBody,
    complete: true
  };
}

/**
 * Top-level entry point. Tries each pattern in order of frequency
 * (heredoc most common in code generation, then echo, then printf).
 *
 * Returns `null` if the command is not a recognisable single-target
 * write — the caller falls back to the renderer's synthesised
 * preview (or no preview at all for non-write commands).
 */
export function tryParseBashWrite(command: string): BashWriteOp | null {
  if (!command || typeof command !== 'string') return null;
  // Quick reject — every supported pattern contains a `>` somewhere.
  if (!command.includes('>')) return null;
  return matchHeredoc(command) ?? matchEchoRedirection(command) ?? matchPrintfRedirection(command);
}
