/**
 * SubAgentScopeList — Tools + Files lists for the Briefing panel.
 *
 * Replaces the old horizontal pill rows in `SubAgentHeader` with a
 * structured, scannable list. Each entry shows a fixed-width type
 * marker, the symbol/path, and a one-line rationale.
 *
 * Tool rationale is sourced from `TOOL_ONE_LINERS` in
 * `@shared/types/toolDescriptions` so the user-facing text is
 * authored alongside the canonical tool registry. File rationale
 * is derived from the directive: `inlined for context` for paths
 * that the pre-spawn validator resolved against the workspace FS,
 * `not found in workspace` for paths the validator could not
 * resolve.
 *
 * Files are clickable when `openWorkspaceFile` succeeds — same
 * affordance the timeline `EditInvocation` uses on its filename.
 */

import { FileWarning, FileCode2, Wrench } from 'lucide-react';
import type { ToolName } from '@shared/types/tool.js';
import { TOOL_ONE_LINERS } from '@shared/types/toolDescriptions.js';
import { useWorkspaceStore } from '../../../../store/useWorkspaceStore.js';
import { openWorkspaceFile } from '../../../../lib/openPath.js';
import { DetailPane } from '../../tools/shared/DetailPane.js';
import { cn } from '../../../../lib/cn.js';

interface SubAgentScopeListProps {
  tools: readonly string[];
  okFiles: readonly string[];
  missingFiles: readonly string[];
}

export function SubAgentScopeList({
  tools,
  okFiles,
  missingFiles
}: SubAgentScopeListProps) {
  const hasTools = tools.length > 0;
  const hasFiles = okFiles.length > 0 || missingFiles.length > 0;
  if (!hasTools && !hasFiles) return null;

  return (
    <DetailPane label="scope">
      <div className="flex flex-col gap-2 rounded-inner border border-border-subtle/30 bg-surface-overlay/40 px-3 py-2">
        {hasTools && <ToolList tools={tools} />}
        {hasTools && hasFiles && (
          <div className="h-px w-full bg-border-subtle/30" aria-hidden="true" />
        )}
        {hasFiles && <FileList okFiles={okFiles} missingFiles={missingFiles} />}
      </div>
    </DetailPane>
  );
}

function ToolList({ tools }: { tools: readonly string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-meta uppercase tracking-wider text-text-faint">
        <Wrench className="h-3 w-3" strokeWidth={2} />
        Granted tools
      </div>
      <ul className="flex flex-col gap-0.5">
        {tools.map((toolName) => {
          const liner = TOOL_ONE_LINERS[toolName as ToolName] ?? '';
          return (
            <li
              key={toolName}
              className="flex items-baseline gap-2 text-row leading-relaxed"
            >
              <span className="w-16 shrink-0 truncate font-mono text-text-secondary">
                {toolName}
              </span>
              <span className="min-w-0 flex-1 text-text-muted">
                {liner || 'No description available.'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileList({
  okFiles,
  missingFiles
}: {
  okFiles: readonly string[];
  missingFiles: readonly string[];
}) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const onOpenFile = (filePath: string) => {
    void openWorkspaceFile(filePath, {
      ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
      context: 'sub-agent-briefing'
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-meta uppercase tracking-wider text-text-faint">
        <FileCode2 className="h-3 w-3" strokeWidth={2} />
        Files in scope
      </div>
      <ul className="flex flex-col gap-0.5">
        {okFiles.map((filePath) => (
          <li
            key={`ok:${filePath}`}
            className="flex items-baseline gap-2 text-row leading-relaxed"
          >
            <button
              type="button"
              onClick={() => onOpenFile(filePath)}
              title={`Open ${filePath}`}
              className={cn(
                'app-no-drag min-w-0 flex-1 truncate text-left font-mono text-text-secondary',
                'transition-colors duration-150 hover:text-accent'
              )}
            >
              {filePath}
            </button>
            <span className="shrink-0 text-meta text-text-faint">inlined</span>
          </li>
        ))}
        {missingFiles.map((filePath) => (
          <li
            key={`miss:${filePath}`}
            className="flex items-baseline gap-2 text-row leading-relaxed"
            title={`${filePath} — not found in workspace`}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-danger line-through decoration-danger/60">
              {filePath}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-meta text-danger">
              <FileWarning className="h-3 w-3" strokeWidth={2} />
              not found
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
