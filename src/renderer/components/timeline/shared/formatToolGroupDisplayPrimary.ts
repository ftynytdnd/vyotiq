/**
 * Collapsed tool-group label formatting — basename paths, trim commands.
 */

import type { ToolName } from '@shared/types/tool.js';
import { basenameFromPath } from '@shared/text/languageFromPath.js';

export function formatToolGroupDisplayPrimary(
  toolName: ToolName,
  primary: string
): { display: string; title?: string } {
  if (!primary) return { display: primary };

  switch (toolName) {
    case 'read':
    case 'ls':
    case 'edit':
    case 'delete': {
      if (primary === 'workspace' || primary === '.' || primary === './') {
        return { display: primary };
      }
      const base = basenameFromPath(primary);
      return base !== primary ? { display: base, title: primary } : { display: primary };
    }
    case 'bash': {
      const firstLine = primary.split('\n')[0] ?? primary;
      const display =
        firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
      if (primary.includes('\n') || display !== primary) {
        return { display, title: primary };
      }
      return { display };
    }
    default: {
      if (primary.length <= 80) return { display: primary };
      return { display: `${primary.slice(0, 79)}…`, title: primary };
    }
  }
}
