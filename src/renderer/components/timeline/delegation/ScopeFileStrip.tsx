/**
 * Compact read-only scope strip for files granted to a sub-agent.
 */

import { FileCode2 } from 'lucide-react';
import { DetailPane } from '../tools/shared/DetailPane.js';
import { SurfaceShell } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';

interface ScopeFileStripProps {
  files: readonly string[];
}

export function ScopeFileStrip({ files }: ScopeFileStripProps) {
  if (files.length === 0) return null;

  return (
    <DetailPane label="files in scope">
      <SurfaceShell padded padding="content">
        <ul className="flex flex-col gap-0.5">
          {files.map((filePath) => (
            <li
              key={filePath}
              className="flex items-center gap-2 vx-provider-meta text-row text-text-secondary"
            >
              <FileCode2
                className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')}
                strokeWidth={SHELL_ROW_ICON_STROKE}
                aria-hidden
              />
              <span className="min-w-0 truncate" title={filePath}>
                {filePath}
              </span>
              <span className="shrink-0 vx-caption">inlined</span>
            </li>
          ))}
        </ul>
      </SurfaceShell>
    </DetailPane>
  );
}
