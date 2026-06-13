/**
 * Composer mention search IPC.
 */

import { IPC } from '@shared/constants.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { searchWorkspaceSymbols, type SymbolSearchHit } from '../mentions/searchSymbols.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertObject, assertString } from './validate.js';

export function registerMentionsIpc(): void {
  wrapIpcHandler(
    IPC.MENTIONS_SEARCH_SYMBOLS,
    async (
      _event,
      input: { workspaceId: string; query: string }
    ): Promise<{ hits: SymbolSearchHit[] }> => {
      assertObject('mentions:search-symbols', 'input', input);
      assertString('mentions:search-symbols', 'input.workspaceId', input.workspaceId);
      assertString('mentions:search-symbols', 'input.query', input.query, { nonEmpty: false });
      const workspacePath = await requireWorkspaceById(input.workspaceId);
      const hits = await searchWorkspaceSymbols(workspacePath, input.query);
      return { hits };
    }
  );
}
