/**
 * Coverage for `stripDelegatesForDisplay` — the helper that hides the
 * orchestrator's machine-readable `<delegate />` XML scaffolding from
 * the rendered timeline. The mid-stream regression below is the one
 * visible in the UI screenshots: a partial `<delegate id="…"` (no
 * closing `>` yet) was leaking into the markdown body.
 */

import { describe, expect, it } from 'vitest';
import { stripDelegatesForDisplay } from '@renderer/lib/text';

describe('stripDelegatesForDisplay', () => {
  it('strips a fully-formed self-closing delegate', () => {
    const out = stripDelegatesForDisplay(
      'plan ahead\n<delegate id="a" task="x" />\n'
    );
    expect(out).toBe('plan ahead');
  });

  it('strips a paired delegate block', () => {
    const out = stripDelegatesForDisplay(
      'before\n<delegate id="a">inner</delegate>\nafter'
    );
    expect(out).toBe('before\n\nafter');
  });

  it('strips an unclosed delegate tag at the tail of a streaming buffer', () => {
    const out = stripDelegatesForDisplay(
      'Good. Now let me delegate the TODO search across the codebase in parallel.\n\n<delegate id="abc"'
    );
    expect(out).toBe(
      'Good. Now let me delegate the TODO search across the codebase in parallel.'
    );
  });

  it('strips a half-typed `<delegate` with no attributes yet', () => {
    expect(stripDelegatesForDisplay('hello\n\n<delegate')).toBe('hello');
  });

  it('does NOT touch unrelated `<` characters earlier in the buffer', () => {
    const out = stripDelegatesForDisplay(
      'use `a < b` then\n<delegate id="x"'
    );
    expect(out).toBe('use `a < b` then');
  });

  // Regression (screenshot bug): the model emitted a `task="..."` whose
  // value contained `<%ae>` (git log email specifier). The old regex
  // stopped at the first `>` inside the value, leaking the tail of the
  // directive (`..." files="" tools="bash" />`) into the rendered text.
  it('strips a delegate whose task attribute contains `<` and `>`', () => {
    const input =
      'before\n<delegate id="A1" task="Run `git log -3 --pretty=format:\'%H%n%an <%ae>%nDate: %ad\'` in the repo." files="" tools="bash" />\nafter';
    expect(stripDelegatesForDisplay(input)).toBe('before\n\nafter');
  });

  it('strips a delegate whose task contains a bash redirect operator', () => {
    const input =
      'pre\n<delegate id="A1" task="Run `grep TODO 2>&1 > out.log` in the repo." files="" tools="bash" />\npost';
    expect(stripDelegatesForDisplay(input)).toBe('pre\n\npost');
  });

  it('strips a delegate that uses single-quoted attribute values', () => {
    const input = `<delegate id='A1' task='Read the config and summarize.' files='src/config.ts' />`;
    expect(stripDelegatesForDisplay(input)).toBe('');
  });

  // Regression (screenshots §1 / §2): the model emits `task="…"` values
  // containing embedded `"` characters because its prose legitimately
  // quotes Python / JSON / shell literals (`"system"`, `"user"`,
  // `"other"`). The previous `[^"]*` matcher closed the value at the
  // FIRST embedded `"` and the strip silently failed, leaking the
  // entire `<delegate />` envelope into user-visible chat — three
  // numbered fix descriptions, file paths, tool names, and all.
  // The fix in `@shared/text/strip.ts` uses a lookahead-driven
  // quote-aware matcher; this test pins the §1 case end-to-end.
  it('strips a delegate whose task contains embedded `"other"`-style quotes (§1 regression)', () => {
    const input =
      'Understood. I will implement all fixes systematically across multiple waves.\n\n' +
      '<delegate id="B1" task="Fix tools/base.py — the class-level `category: str = "other"` is shadowed by a `@property` descriptor. ' +
      'Reading `tool.category` returns the property object, not a string." ' +
      'files="tools/base.py" tools="read,edit" />\n\n' +
      'Watch the timeline.';
    const out = stripDelegatesForDisplay(input);
    expect(out).not.toContain('<delegate');
    expect(out).not.toContain('task=');
    expect(out).not.toContain('files=');
    expect(out).not.toContain('tools=');
    expect(out).not.toContain('"other"');
    expect(out).toContain('Understood. I will implement');
    expect(out).toContain('Watch the timeline.');
  });

  it('strips a delegate whose task contains MULTIPLE embedded quotes spanning Python literals (§2 regression)', () => {
    const input =
      'Wave 2 plan:\n\n' +
      '<delegate id="B4" ' +
      'task="Replace raw string role comparisons (`role == "system"`, `role == "user"`, `role == "assistant"`) with enum comparisons. Be careful — some role values may come from external sources." ' +
      'files="core/conversation.py,core/types.py" tools="read,edit" />\n\n' +
      'All Wave 2 changes applied.';
    const out = stripDelegatesForDisplay(input);
    expect(out).not.toContain('<delegate');
    expect(out).not.toContain('"system"');
    expect(out).not.toContain('"user"');
    expect(out).not.toContain('"assistant"');
    expect(out).toContain('Wave 2 plan:');
    expect(out).toContain('All Wave 2 changes applied.');
  });

  it('strips a multi-paragraph delegate envelope with embedded quotes (§1 full leak)', () => {
    // Faithful reconstruction of the §1 leak — three numbered fix
    // descriptions packed into one `task=""` attribute. Every byte of
    // the envelope must be removed; only the surrounding prose
    // ("Understood..." and "Watch the timeline.") may remain.
    const input =
      'Understood. I will implement all fixes systematically across multiple waves.\n\n' +
      '<delegate id="B1" task="Fix these three files:\n\n' +
      '1. ui/stream_renderer.py — CRITICAL: Add missing imports. The method `render_events()` calls `isinstance(chunk, ThinkingDelta)` and similar checks but none of these types are imported.\n\n' +
      '2. tools/base.py — Fix the broken `category` property. The class-level `category: str = "other"` is shadowed by a `@property` descriptor.\n\n' +
      '3. tools/registry.py — CRITICAL: `AgentTool` is never registered in `create_default_registry()`." ' +
      'files="ui/stream_renderer.py,tools/base.py,tools/registry.py" tools="read,edit" />\n\n' +
      'Watch the timeline.';
    const out = stripDelegatesForDisplay(input);
    expect(out).not.toContain('<delegate');
    expect(out).not.toContain('"other"');
    expect(out).not.toContain('AgentTool');
    expect(out).not.toContain('stream_renderer.py');
    expect(out).toContain('Understood. I will implement');
    expect(out).toContain('Watch the timeline.');
  });

  // Regression (screenshots 6 + 8): the model emitted a DSML-style
  // section divider `</| | DSML | | tool_calls>` between paragraphs.
  // The old strip only handled `<delegate>` tags so the literal
  // envelope rendered as visible garbage.
  it('strips a bare `</| ... |>` DSML envelope token', () => {
    const out = stripDelegatesForDisplay(
      'before\n\n</| | DSML | | tool_calls>\n\nafter'
    );
    expect(out).toBe('before\n\nafter');
  });

  it('strips a paired `<run_state>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'narrate\n<run_state>iter=3 nudges=1/2</run_state>\nmore narration'
    );
    expect(out).toBe('narrate\n\nmore narration');
  });

  it('strips a paired `<tool_calls>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'pre\n<tool_calls>{"name":"ls"}</tool_calls>\npost'
    );
    expect(out).toBe('pre\n\npost');
  });

  it('strips a self-closing `<task />` envelope', () => {
    const out = stripDelegatesForDisplay('a\n<task id="t1" />\nb');
    expect(out).toBe('a\n\nb');
  });

  // The remaining context envelopes the host injects on every iteration
  // (`<workspace_context>`, `<meta_rules>`, `<session_context>`,
  // `<prior_conversations>`, `<recent_memory>`, `<host_environment>`)
  // must also be stripped if the model ever echoes them back inside
  // user-facing prose. Regression: pre-fix, `strip.ts` listed the
  // literal `current_workspace_context` — a name no `wrapXml(...)` call
  // in the codebase actually emits — so a model echoing the real
  // `<workspace_context>` envelope back would render raw XML. Each case
  // below proves the canonical envelope name is now on the allowlist.
  it('strips a paired `<workspace_context>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'pre\n<workspace_context>src/\n  index.ts</workspace_context>\npost'
    );
    expect(out).toBe('pre\n\npost');
  });

  it('strips a paired `<host_environment>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'pre\n<host_environment>now_utc: 2026-05-19T02:00:00.000Z\nlocale: en-US</host_environment>\npost'
    );
    expect(out).toBe('pre\n\npost');
  });

  it('strips a paired `<meta_rules>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'pre\n<meta_rules>- prefer terse output</meta_rules>\npost'
    );
    expect(out).toBe('pre\n\npost');
  });

  it('strips a paired `<session_context>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'pre\n<session_context>title="planning"</session_context>\npost'
    );
    expect(out).toBe('pre\n\npost');
  });

  it('strips a paired `<prior_conversations>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'pre\n<prior_conversations>(none yet)</prior_conversations>\npost'
    );
    expect(out).toBe('pre\n\npost');
  });

  it('strips a paired `<recent_memory>` envelope', () => {
    const out = stripDelegatesForDisplay(
      'pre\n<recent_memory>(no persistent notes matched)</recent_memory>\npost'
    );
    expect(out).toBe('pre\n\npost');
  });

  // Tail-partial coverage for the two envelope tags most likely to
  // appear at a mid-stream buffer boundary: `<host_environment>` (long
  // body, host-injected every iteration) and `<workspace_context>`
  // (same). Matches the existing `<run_state` partial test below — the
  // strip's tail-partial contract triggers ONLY on an opening tag that
  // hasn't been closed with `>` yet (mid-body partials past `>` are
  // out-of-contract because the renderer can't safely guess where the
  // closing tag would have landed).
  it('strips a partial `<host_environment` at the buffer tail', () => {
    const out = stripDelegatesForDisplay(
      'narrate\n<host_environment'
    );
    expect(out).toBe('narrate');
  });

  it('strips a partial `<workspace_context` at the buffer tail', () => {
    const out = stripDelegatesForDisplay(
      'narrate\n<workspace_context'
    );
    expect(out).toBe('narrate');
  });

  // The OLD literal — `<current_workspace_context>` — was on the
  // pre-fix allowlist but no code path emits it. We DO NOT add it
  // back to the allowlist (any model legitimately quoting the
  // string would be a user-prose mention, not an echoed envelope).
  // This test pins that the strip leaves it alone.
  it('leaves the stale literal `<current_workspace_context>` untouched', () => {
    const out = stripDelegatesForDisplay(
      'I think the renamed envelope is `<current_workspace_context>` — historical.'
    );
    expect(out).toContain('<current_workspace_context>');
  });

  it('strips a partial `<run_state` at the buffer tail', () => {
    const out = stripDelegatesForDisplay(
      'streaming text continues\n<run_state iter="3"'
    );
    expect(out).toBe('streaming text continues');
  });

  it('strips a partial bare envelope `</| | DSML` at the buffer tail', () => {
    const out = stripDelegatesForDisplay(
      'narrate\n\n</| | DSML'
    );
    expect(out).toBe('narrate');
  });

  // Pure-orchestration fences (body is ONLY orchestration tags) are
  // DROPPED — this is the screenshots §2/§3 leak case where the
  // orchestrator wrapped its own `<delegate>` envelope in a code
  // fence. Surrounding prose stays.
  it('drops a fence whose body is exclusively a `<delegate />` envelope', () => {
    const input =
      'Plan ahead.\n\n' +
      '```\n' +
      '<delegate id="A1" task="Read config" />\n' +
      '```\n\n' +
      'Then we synthesize.';
    const out = stripDelegatesForDisplay(input);
    expect(out).not.toContain('<delegate');
    expect(out).toContain('Plan ahead.');
    expect(out).toContain('Then we synthesize.');
  });

  it('drops a fence whose body is a stack of pure orchestration envelopes', () => {
    const input =
      'Delegating:\n\n' +
      '```\n' +
      '<delegate id="A1" task="t1" />\n' +
      '<delegate id="A2" task="t2" />\n' +
      '<delegate id="A3" task="t3" />\n' +
      '```\n\n' +
      'Watch the timeline.';
    const out = stripDelegatesForDisplay(input);
    expect(out).not.toContain('<delegate');
    expect(out).toContain('Delegating:');
    expect(out).toContain('Watch the timeline.');
  });

  it('drops a language-tagged fence whose body is pure orchestration', () => {
    const input =
      'Format:\n\n' +
      '```xml\n' +
      '<delegate id="A1" task="x" />\n' +
      '```\n\n' +
      'done';
    const out = stripDelegatesForDisplay(input);
    expect(out).not.toContain('<delegate');
    expect(out).toContain('Format:');
    expect(out).toContain('done');
  });

  it('drops a tilde-fenced pure DSML envelope', () => {
    const input =
      'doc:\n\n' +
      '~~~\n' +
      '</| | DSML | | tool_calls>\n' +
      '~~~\n\n' +
      'after';
    const out = stripDelegatesForDisplay(input);
    expect(out).not.toContain('</|');
    expect(out).toContain('doc:');
    expect(out).toContain('after');
  });

  // Mixed fences (any non-orchestration content) MUST be preserved
  // verbatim — only the pure-orchestration case is the leak we close.
  it('preserves a fence that mixes prose with a `<delegate />` example', () => {
    const input =
      'Format:\n\n' +
      '```\n' +
      '<!-- example delegation -->\n' +
      '<delegate id="A1" task="Read config" />\n' +
      '<!-- end example -->\n' +
      '```\n';
    const out = stripDelegatesForDisplay(input);
    expect(out).toContain('<delegate id="A1" task="Read config" />');
    expect(out).toContain('<!-- example delegation -->');
  });

  it('preserves a fenced code block containing real source code', () => {
    const input =
      'Snippet:\n\n' +
      '```ts\n' +
      'export function add(a: number, b: number): number {\n' +
      '  return a + b;\n' +
      '}\n' +
      '```\n';
    const out = stripDelegatesForDisplay(input);
    expect(out).toContain('export function add(a: number, b: number)');
    expect(out).toContain('```ts');
  });

  // C++ template / generic syntax must NEVER be touched (it's not in
  // the allowlist and isn't a DSML envelope).
  it('leaves C++ generics like `std::vector<int>` untouched', () => {
    const out = stripDelegatesForDisplay('use std::vector<int> here');
    expect(out).toBe('use std::vector<int> here');
  });

  // Vue/HTML `<template>` is not in the allowlist; user prose
  // mentioning it must pass through.
  it('leaves a `<template>` tag in prose untouched', () => {
    const out = stripDelegatesForDisplay(
      'Vue uses <template> blocks.'
    );
    expect(out).toBe('Vue uses <template> blocks.');
  });

  // Mid-stream orchestration often opens a ``` fence before emitting
  // `<delegate />` tags. After the tail-partial orch strip removes the
  // unfinished directive, the fence opener must not survive — otherwise
  // ReactMarkdown renders an empty gray `<pre>` bar under the plan prose.
  it('drops a trailing open fence left after stripping a partial delegate', () => {
    const input =
      'Plan:\n1. Analyze.\n2. Draft README.\n3. Generate docs.\n\n' +
      '```xml\n<delegate id="A1" task="Create README"';
    const out = stripDelegatesForDisplay(input);
    expect(out).toBe(
      'Plan:\n1. Analyze.\n2. Draft README.\n3. Generate docs.'
    );
    expect(out).not.toContain('```');
  });

  it('drops a trailing open fence with no body yet', () => {
    const input =
      'Plan:\n1. Analyze.\n2. Draft README.\n3. Generate docs.\n\n```xml\n';
    const out = stripDelegatesForDisplay(input);
    expect(out).toBe(
      'Plan:\n1. Analyze.\n2. Draft README.\n3. Generate docs.'
    );
  });
});
