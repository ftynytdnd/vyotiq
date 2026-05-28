/**
 * Compact read-only scope strip for files granted to a sub-agent.
 */

import { FileCode2 } from 'lucide-react';
import { DetailPane } from '../tools/shared/DetailPane.js';
import { SurfaceShell } from '../../ui/SurfaceShell.js';

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
              className="flex items-center gap-2 font-mono text-row text-text-secondary"
            >
              <FileCode2 className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
              <span className="min-w-0 truncate" title={filePath}>
                {filePath}
              </span>
              <span className="shrink-0 text-meta text-text-faint">inlined</span>
            </li>
          ))}
        </ul>
      </SurfaceShell>
    </DetailPane>
  );
}
