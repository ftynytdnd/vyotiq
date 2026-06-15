/**
 * Shell Mono syntax highlighting for CodeMirror 6.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const shellMonoHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--color-syntax-keyword)' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: 'var(--color-syntax-name)' },
  { tag: [t.propertyName], color: 'var(--color-syntax-property)' },
  {
    tag: [t.function(t.variableName), t.labelName],
    color: 'var(--color-syntax-function)'
  },
  {
    tag: [t.typeName, t.className, t.namespace],
    color: 'var(--color-syntax-type)'
  },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.color], color: 'var(--color-syntax-number)' },
  { tag: [t.operator, t.operatorKeyword], color: 'var(--color-syntax-operator)' },
  { tag: [t.url, t.escape, t.regexp, t.link], color: 'var(--color-syntax-regexp)' },
  { tag: [t.meta, t.comment], color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--color-syntax-link)', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--color-syntax-heading)' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: 'var(--color-syntax-atom)' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: 'var(--color-syntax-string)' },
  { tag: t.invalid, color: 'var(--color-danger)' }
]);

export const shellMonoSyntaxHighlighting = syntaxHighlighting(shellMonoHighlightStyle, { fallback: true });
