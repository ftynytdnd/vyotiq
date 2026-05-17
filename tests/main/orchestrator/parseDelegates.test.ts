/**
 * `parseDelegates` is the orchestrator's boundary between free-form
 * assistant text and the structured directives the host acts on. The
 * regex has historically drifted in lockstep with the renderer-side
 * strip; these tests lock both the happy path and the embedded-
 * `<`/`>` regression (screenshot bug) so the two sides can never
 * diverge again.
 */

import { describe, expect, it } from 'vitest';
import {
  parseDelegates,
  parseDelegatesWithDuplicates
} from '@main/orchestrator/envelope/parseDelegates';

describe('parseDelegates', () => {
  it('parses a minimal self-closing directive', () => {
    const out = parseDelegates(
      '<delegate id="A1" task="Read config" files="src/config.ts" />'
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'A1',
      task: 'Read config',
      files: ['src/config.ts'],
      tools: []
    });
  });

  it('parses every attribute and splits files / tools', () => {
    const out = parseDelegates(
      '<delegate id="A1" task="T" files="a.ts, b.ts" tools="read, bash" />'
    );
    expect(out[0]?.files).toEqual(['a.ts', 'b.ts']);
    expect(out[0]?.tools).toEqual(['read', 'bash']);
  });

  it('drops directives missing required attributes (id / task)', () => {
    expect(parseDelegates('<delegate id="A1" />')).toEqual([]);
    expect(parseDelegates('<delegate task="T" />')).toEqual([]);
  });

  // Regression (screenshot bug): the model emitted a git-log format
  // string containing `<%ae>`. The old parser stopped at the first `>`
  // inside `task="..."`, returning zero directives AND leaking the
  // tail into user-visible text. Both symptoms must stay fixed.
  it('parses a directive whose task attribute contains `<` and `>`', () => {
    const input =
      '<delegate id="A1" task="Run `git log -3 --pretty=format:\'%H%n%an <%ae>%nDate: %ad\'`." files="" tools="bash" />';
    const out = parseDelegates(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('A1');
    expect(out[0]?.task).toContain('<%ae>');
    expect(out[0]?.tools).toEqual(['bash']);
  });

  it('parses a directive containing a bash redirect (`2>&1`)', () => {
    const out = parseDelegates(
      '<delegate id="A1" task="Run `grep TODO 2>&1 > out.log`." files="" tools="bash" />'
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.task).toContain('2>&1');
    expect(out[0]?.task).toContain('> out.log');
  });

  it('accepts single-quoted attribute values', () => {
    const out = parseDelegates(
      `<delegate id='A1' task='Summarize the file.' files='src/x.ts' />`
    );
    expect(out[0]).toMatchObject({
      id: 'A1',
      task: 'Summarize the file.',
      files: ['src/x.ts']
    });
  });

  it('parses multiple directives in a single assistant turn', () => {
    const out = parseDelegates(
      `<delegate id="A1" task="first" files="a.ts" />\n` +
      `<delegate id="A2" task="second" files="b.ts" />`
    );
    expect(out.map((d) => d.id)).toEqual(['A1', 'A2']);
  });

  // Regression: a model emitting two `<delegate id="A1" …/>` in the
  // same turn used to spawn two sub-agents sharing an id; the renderer
  // reducer keys snapshots by `subagentId` and silently collapsed both
  // into one, losing one run's output. `parseDelegates` now dedupes
  // on the parse side (first occurrence wins) so the orchestrator
  // spawns at most one sub-agent per id per turn.
  it('dedupes duplicate ids within the same text (first wins)', () => {
    const out = parseDelegates(
      `<delegate id="A1" task="first" files="a.ts" />\n` +
      `<delegate id="A1" task="second attempt" files="b.ts" />\n` +
      `<delegate id="A2" task="third" files="c.ts" />`
    );
    expect(out.map((d) => d.id)).toEqual(['A1', 'A2']);
    expect(out[0]?.task).toBe('first');
    expect(out[0]?.files).toEqual(['a.ts']);
  });

  it('ignores `<delegate` fragments that never close', () => {
    const out = parseDelegates('prose\n<delegate id="A1" task="half');
    expect(out).toEqual([]);
  });

  // Regression (screenshots §1 / §2): the model emits `task="…"`
  // values containing embedded `"` characters because its prose
  // legitimately quotes Python / JSON / shell literals like
  // `"system"`, `"user"`, `"other"`. The previous `[^"]*` matcher
  // closed the value at the FIRST embedded `"` and the whole regex
  // failed — `parseDelegates` returned [] and the orchestrator
  // silently dropped the model's actual delegation intent while the
  // un-stripped envelope leaked into user-visible chat.
  //
  // The fix in `parseDelegates.ts` and `@shared/text/strip.ts` uses
  // a lookahead-driven quote-aware matcher: `"` is a real closing
  // quote ONLY IF it is followed by tag-close (`>` / `/>`) or the
  // start of the next attribute (`name=`). Any other lookahead is
  // embedded prose.
  it('parses a directive whose task contains embedded double quotes (§1 regression)', () => {
    const input =
      '<delegate id="B1" task="Fix tools/base.py — the class-level `category: str = "other"` is shadowed by a `@property` descriptor. ' +
      'Reading `tool.category` returns the property object, not a string." ' +
      'files="tools/base.py" tools="read,edit" />';
    const out = parseDelegates(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('B1');
    expect(out[0]?.task).toContain('"other"');
    expect(out[0]?.task).toContain('@property');
    expect(out[0]?.files).toEqual(['tools/base.py']);
    expect(out[0]?.tools).toEqual(['read', 'edit']);
  });

  it('parses a directive whose task contains MULTIPLE embedded double quotes (§2 regression)', () => {
    // Pulled near-verbatim from §2: a `task` value that quotes three
    // separate Python string literals (`"system"`, `"user"`,
    // `"assistant"`). All three pairs of quotes must be preserved in
    // the parsed `task` string.
    const input =
      '<delegate id="B4" ' +
      'task="Replace raw string role comparisons (`role == "system"`, `role == "user"`, `role == "assistant"`) with enum comparisons. Be careful — some role values may come from external sources." ' +
      'files="core/conversation.py,core/types.py" tools="read,edit" />';
    const out = parseDelegates(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.task).toContain('"system"');
    expect(out[0]?.task).toContain('"user"');
    expect(out[0]?.task).toContain('"assistant"');
    expect(out[0]?.files).toEqual(['core/conversation.py', 'core/types.py']);
  });

  it('parses a multi-paragraph task with embedded quotes spanning newlines (§1 full envelope)', () => {
    // Faithful reconstruction of the §1 leak: a single `<delegate />`
    // whose `task=""` carries three numbered fix descriptions
    // separated by blank lines, with several embedded backtick code
    // spans containing literal `"` characters.
    const input =
      '<delegate id="B1" task="Fix these three files:\n\n' +
      '1. ui/stream_renderer.py — CRITICAL: Add missing imports at the top of the file. ' +
      'The method `render_events()` calls `isinstance(chunk, ThinkingDelta)`, ' +
      '`isinstance(chunk, UsageEvent)`, and `isinstance(chunk, StreamEvent)` ' +
      'but none of these types are imported.\n\n' +
      '2. tools/base.py — Fix the broken `category` property. ' +
      'The class-level `category: str = "other"` is shadowed by a `@property` descriptor. ' +
      'Reading `tool.category` returns the property object, not a string.\n\n' +
      '3. tools/registry.py — CRITICAL: `AgentTool` is never registered in `create_default_registry()`. ' +
      'The function registers 6 always-on tools but omits `AgentTool`." ' +
      'files="ui/stream_renderer.py,tools/base.py,tools/registry.py" tools="read,edit" />';
    const out = parseDelegates(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('B1');
    expect(out[0]?.task).toContain('"other"');
    expect(out[0]?.task).toContain('1. ui/stream_renderer.py');
    expect(out[0]?.task).toContain('3. tools/registry.py');
    expect(out[0]?.files).toEqual([
      'ui/stream_renderer.py',
      'tools/base.py',
      'tools/registry.py'
    ]);
  });

  it('still terminates the value at the structural close even when the value ends with an embedded quote', () => {
    // Pin the lookahead's "real close" branch: a `"` followed by ` files=`
    // remains the actual closing quote even if the value text is itself
    // entirely a quoted phrase. Template literal so the embedded `"`
    // characters are part of the runtime string verbatim.
    const input = `<delegate id="A1" task="phrase "hello world" then more" files="x.ts" tools="read" />`;
    const out = parseDelegates(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('A1');
    expect(out[0]?.task).toContain('"hello world"');
    expect(out[0]?.task).toContain('then more');
    expect(out[0]?.files).toEqual(['x.ts']);
    expect(out[0]?.tools).toEqual(['read']);
  });

  it('parses a paired `<delegate>...</delegate>` form too', () => {
    // The regex currently treats the opening tag as self-closing-ish
    // (`/?>`) so the inner body is left in the text. The parsed
    // directive still populates its required attributes from the
    // opening tag — that's what the orchestrator acts on.
    const out = parseDelegates(
      '<delegate id="A1" task="t">body</delegate>'
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('A1');
  });
});

describe('parseDelegatesWithDuplicates', () => {
  // Regression (review finding B1): the parser used to swallow duplicate
  // ids silently — `parseDelegates` returned only the first occurrence
  // and the second was dropped with no signal to the call site. The
  // call site (`runLoop`) had no way to surface the drop to the user
  // or to the run-logger; a model emitting two `<delegate id="A1" …/>`
  // looked identical to one that emitted just one. The new
  // `parseDelegatesWithDuplicates` shape exposes the dropped ids so
  // the orchestrator can emit a `phase` timeline event AND warn.
  it('reports zero duplicates on a clean input', () => {
    const out = parseDelegatesWithDuplicates(
      '<delegate id="A1" task="t" files="a.ts" />'
    );
    expect(out.directives).toHaveLength(1);
    expect(out.duplicates).toEqual([]);
  });

  it('reports the dropped id when a duplicate occurs', () => {
    const out = parseDelegatesWithDuplicates(
      '<delegate id="A1" task="first" files="a.ts" />\n' +
      '<delegate id="A1" task="second" files="b.ts" />'
    );
    expect(out.directives).toHaveLength(1);
    expect(out.directives[0]?.task).toBe('first');
    expect(out.duplicates).toEqual(['A1']);
  });

  it('reports every duplicated occurrence in insertion order', () => {
    // The same id appearing three times produces TWO duplicate
    // entries (the 2nd + 3rd occurrence). Order is preserved so the
    // call site can attribute drops to a specific position if it
    // ever needs to (today it dedupes via Set before rendering, but
    // the parser stays positionally honest).
    const out = parseDelegatesWithDuplicates(
      '<delegate id="A1" task="first" />\n' +
      '<delegate id="A2" task="other" />\n' +
      '<delegate id="A1" task="second drop" />\n' +
      '<delegate id="A1" task="third drop" />'
    );
    expect(out.directives.map((d) => d.id)).toEqual(['A1', 'A2']);
    expect(out.duplicates).toEqual(['A1', 'A1']);
  });

  it('keeps `parseDelegates` backward-compatible (returns just the directives)', () => {
    // The bare form must continue to return ParsedDelegate[] so every
    // existing call site (handleAssistantTurn mid-stream parser) stays
    // unaffected by the new shape.
    const out = parseDelegates(
      '<delegate id="A1" task="first" />\n' +
      '<delegate id="A1" task="second" />'
    );
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]?.task).toBe('first');
  });

  // Review finding H1: the harness explicitly forbids fenced
  // directives ("never inside a code fence and never as a quoted
  // preview"), but soft rules degrade. The parser MUST refuse to
  // match `<delegate />` inside ``` / ~~~ fences so a model that
  // narrates *"I'll send: \`\`\`xml\n<delegate ... />\n\`\`\`"*
  // doesn't accidentally spawn a real worker.
  describe('fenced-code guard (H1)', () => {
    it('does not parse a directive inside a closed ``` fence', () => {
      const input =
        'Here is the directive shape:\n' +
        '```xml\n' +
        '<delegate id="A1" task="should-not-spawn" />\n' +
        '```\n' +
        'I will send the real one separately.';
      expect(parseDelegates(input)).toEqual([]);
    });

    it('does not parse a directive inside a closed ~~~ fence', () => {
      const input =
        'Example:\n' +
        '~~~\n' +
        '<delegate id="A1" task="nope" />\n' +
        '~~~';
      expect(parseDelegates(input)).toEqual([]);
    });

    it('does not parse a directive inside a TRAILING OPEN fence (mid-stream)', () => {
      // Streaming case: the model has emitted the opener but the
      // closing delimiter hasn't arrived yet. Without the guard the
      // mid-stream `parseDelegates(accumulated)` call in
      // `handleAssistantTurn` would emit `subagent-pending` for a
      // directive the model intends as illustration.
      const input =
        'I will spawn one like:\n' +
        '```xml\n' +
        '<delegate id="A1" task="not-yet" />';
      expect(parseDelegates(input)).toEqual([]);
    });

    it('still parses a real directive after a closed fence', () => {
      // Mixed case: example fence followed by a real directive. The
      // example must stay non-spawning AND the real directive must
      // still parse cleanly.
      const input =
        'Example:\n' +
        '```xml\n' +
        '<delegate id="EX" task="example" />\n' +
        '```\n' +
        '<delegate id="A1" task="real spawn" files="src/x.ts" tools="read" />';
      const out = parseDelegates(input);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('A1');
      expect(out[0]?.task).toBe('real spawn');
    });

    it('still parses a real directive BEFORE an open fence', () => {
      // Real directive precedes the start of an example fence the
      // model started typing. The real one must still spawn.
      const input =
        '<delegate id="A1" task="real" files="x.ts" tools="read" />\n' +
        'For reference, here is the shape:\n' +
        '```xml\n' +
        '<delegate id="EX" task="example';
      const out = parseDelegates(input);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('A1');
    });

    it('handles indented fence info-string without leaking', () => {
      // CommonMark allows up to 3 spaces of indent before a fence.
      // The strip uses line-start anchoring (^|\n) so an indented
      // fence is technically NOT recognised as a fence — but the
      // directive inside still has to be parsed-or-dropped
      // consistently with how the renderer treats it. Today the
      // renderer follows ReactMarkdown which renders 4+ space
      // indents as code blocks but 1-3 as paragraphs. Lock the
      // current behaviour: a leading-space fence (paragraph) IS
      // parsed; a real \n```xml fence is NOT. Both branches
      // exercised here.
      const realFence =
        'Look:\n```xml\n<delegate id="EX" task="t" />\n```';
      expect(parseDelegates(realFence)).toEqual([]);
    });
  });

  /**
   * Review finding M7 — multi-line `<delegate>` directives.
   *
   * The audit conjectured that the parser silently dropped
   * multi-line openers, but on closer inspection `DELEGATE_RE`
   * already treats `\s+` (between attributes) and `[^"]` (inside
   * attribute values) as newline-permissive, so genuine multi-line
   * directives parse correctly. The `malformedOpeners` slot is
   * kept on `ParseDelegatesResult` as a stable surface for a
   * future-discovered failure mode but is empty under today's
   * parser; tests below pin that invariant so a future regression
   * (e.g. tightening one of those character classes) would break
   * loudly here.
   */
  describe('multi-line directives (M7 invariants)', () => {
    it('parses a directive split across lines between attributes', () => {
      const out = parseDelegatesWithDuplicates(
        '<delegate id="A1"\n  task="real spawn" files="x.ts" tools="read" />'
      );
      expect(out.directives).toHaveLength(1);
      expect(out.directives[0]?.id).toBe('A1');
      expect(out.directives[0]?.task).toBe('real spawn');
      expect(out.malformedOpeners).toEqual([]);
    });

    it('parses a directive with a newline INSIDE an attribute value', () => {
      const out = parseDelegatesWithDuplicates(
        '<delegate id="A1" task="line one\nline two" />'
      );
      expect(out.directives).toHaveLength(1);
      expect(out.directives[0]?.task).toContain('line one');
      expect(out.directives[0]?.task).toContain('line two');
      expect(out.malformedOpeners).toEqual([]);
    });

    it('returns empty malformedOpeners for a clean single-line directive', () => {
      const out = parseDelegatesWithDuplicates(
        '<delegate id="A1" task="t" files="x.ts" />'
      );
      expect(out.directives).toHaveLength(1);
      expect(out.malformedOpeners).toEqual([]);
    });

    it('parses a mix of single-line and multi-line directives in one input', () => {
      const out = parseDelegatesWithDuplicates(
        '<delegate id="A1" task="single-line" />\n' +
        '<delegate id="A2"\n  task="multi" />'
      );
      expect(out.directives).toHaveLength(2);
      expect(out.directives.map((d) => d.id).sort()).toEqual(['A1', 'A2']);
      expect(out.malformedOpeners).toEqual([]);
    });
  });
});
