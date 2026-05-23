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

  // The host's fence policy: pure-orchestration fences (a fence
  // body that is *exclusively* `<delegate ... />` markup) are
  // unwrapped by `stripFencedCode` and the directives spawn — the
  // model commonly wraps real directives in ```xml … ``` for
  // syntax highlighting and the host MUST honor those. Mixed
  // prose + directive fences are still treated as illustrations
  // and dropped, so a model narrating *"I'll send something
  // like…"* and then quoting the directive does not accidentally
  // spawn a worker.
  //
  // This restores the failure mode captured in the
  // `679f5c3c-…jsonl` conversation (the model emitted four
  // `<delegate />` directives wrapped in ```xml, the parser saw
  // zero, the loop terminated cleanly, no sub-agents ran). The
  // renderer-side `dropOrchestrationOnlyFences` already used the
  // same heuristic for the display strip; the parser now agrees.
  describe('fenced-code guard — pure-orchestration vs illustration', () => {
    it('SPAWNS a directive whose ``` fence body is exclusively the directive', () => {
      // Pure-orchestration fence: the body strips to empty under
      // the `<delegate>`-only strip → unwrap and spawn. Surrounding
      // prose is preserved by the strip but the directives parse.
      const input =
        '## Plan\n' +
        '```xml\n' +
        '<delegate id="A1" task="real spawn" files="x.ts" tools="read" />\n' +
        '```\n' +
        'Continuing.';
      const out = parseDelegates(input);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('A1');
      expect(out[0]?.task).toBe('real spawn');
    });

    it('SPAWNS multiple directives stacked inside a single ```xml fence', () => {
      // The exact shape captured in the production
      // `679f5c3c-…jsonl` failure: four `<delegate />` directives
      // wrapped in one ```xml block. Pre-fix this was 0 spawns;
      // post-fix every directive must spawn.
      const input =
        'I am launching four agents:\n' +
        '```xml\n' +
        '<delegate id="A1" task="t1" files="a.ts" tools="read" />\n' +
        '<delegate id="A2" task="t2" files="" tools="read,ls" />\n' +
        '<delegate id="A3" task="t3" files="" tools="read,search" />\n' +
        '<delegate id="A4" task="t4" files="" tools="read" />\n' +
        '```';
      const out = parseDelegates(input);
      expect(out.map((d) => d.id)).toEqual(['A1', 'A2', 'A3', 'A4']);
    });

    it('SPAWNS a directive inside a ~~~ fence whose body is purely the directive', () => {
      const input =
        '~~~\n' +
        '<delegate id="A1" task="real" />\n' +
        '~~~';
      const out = parseDelegates(input);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('A1');
    });

    it('SPAWNS a directive inside a trailing OPEN ``` fence (mid-stream pure body)', () => {
      // Streaming case: the closing delimiter has not yet arrived,
      // but the body so far is exclusively the directive. The host
      // must let the mid-stream `subagent-pending` event fire
      // immediately so the renderer paints the row instantly.
      const input =
        '## Spawning workers\n' +
        '```xml\n' +
        '<delegate id="A1" task="streaming" files="x.ts" tools="read" />';
      const out = parseDelegates(input);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('A1');
    });

    it('does NOT spawn a directive inside a fence whose body mixes prose with the directive', () => {
      // Illustration case: prose + directive in the same fence body.
      // The body does NOT strip to empty under the `<delegate>`-only
      // strip → drop the body. The model narrating *"send something
      // like this:"* and quoting the directive must stay non-
      // spawning so callers can show the user a literal example.
      const input =
        '```xml\n' +
        '<!-- example shape, do not run -->\n' +
        '<delegate id="EX" task="example" />\n' +
        '```';
      expect(parseDelegates(input)).toEqual([]);
    });

    it('does NOT spawn a directive inside a fence with surrounding language code', () => {
      // The body has a non-orchestration code line alongside the
      // directive — clearly an illustration. Drop the whole fence.
      const input =
        '```xml\n' +
        '<root>\n' +
        '  <delegate id="EX" task="nope" />\n' +
        '</root>\n' +
        '```';
      expect(parseDelegates(input)).toEqual([]);
    });

    it('still parses a real directive after an illustration fence', () => {
      // Mixed run: an illustration fence (prose + directive) MUST
      // stay non-spawning AND the real directive after the fence
      // must still parse cleanly.
      const input =
        'Example shape:\n' +
        '```xml\n' +
        '<example>\n' +
        '  <delegate id="EX" task="example" />\n' +
        '</example>\n' +
        '```\n' +
        '<delegate id="A1" task="real spawn" files="src/x.ts" tools="read" />';
      const out = parseDelegates(input);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('A1');
      expect(out[0]?.task).toBe('real spawn');
    });

    it('still parses a real directive BEFORE an open fence with prose body', () => {
      // Real directive precedes the start of an illustration fence
      // the model started typing. The real one must still spawn.
      const input =
        '<delegate id="A1" task="real" files="x.ts" tools="read" />\n' +
        'For reference, here is an example with prose:\n' +
        '```xml\n' +
        '<example>partial example';
      const out = parseDelegates(input);
      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe('A1');
    });

    it('SPAWNS a real directive after a pure-orchestration fence (both spawn)', () => {
      // Both fences contain only `<delegate>` markup → both spawn.
      // The real directive after the fence is also picked up.
      const input =
        '```xml\n' +
        '<delegate id="A1" task="first" files="a.ts" tools="read" />\n' +
        '```\n' +
        '<delegate id="A2" task="second" files="b.ts" tools="read" />';
      const out = parseDelegates(input);
      expect(out.map((d) => d.id)).toEqual(['A1', 'A2']);
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
