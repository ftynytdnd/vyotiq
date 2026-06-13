/**
 * Map workspace file paths to CodeMirror language extensions.
 */

import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { languageFromPath } from '@shared/text/languageFromPath.js';

export function codemirrorLanguageForPath(filePath: string): Extension[] {
  const lang = languageFromPath(filePath);
  if (!lang) return [];

  switch (lang) {
    case 'typescript':
      return [javascript({ typescript: true })];
    case 'javascript':
      return [javascript()];
    case 'json':
      return [json()];
    case 'markdown':
      return [markdown()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'html':
    case 'xml':
    case 'svg':
      return [html()];
    case 'python':
      return [python()];
    default:
      return [];
  }
}
