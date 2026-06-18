/**
 * Screen capture button for the composer — lists desktopCapturer sources.
 */

import { useCallback, useState } from 'react';
import { Camera } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import type { CaptureSourceInfo } from '@shared/types/capture.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { guessMimeFromName } from '@shared/attachments/mediaKind.js';

interface CaptureScreenButtonProps {
  disabled?: boolean;
  conversationId: string | null;
  onCaptured: (meta: PromptAttachmentMeta) => void;
}

export function CaptureScreenButton({
  disabled = false,
  conversationId,
  onCaptured
}: CaptureScreenButtonProps) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const showToast = useToastStore((s) => s.show);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const { sources: list } = await vyotiq.capture.listSources();
      setSources(list);
      setOpen(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not list capture sources.', 'danger');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const captureSource = useCallback(
    async (sourceId: string) => {
      const workspaceId = useWorkspaceStore.getState().activeId;
      if (!workspaceId || !conversationId) {
        showToast('Open a workspace and conversation first.', 'danger');
        return;
      }
      try {
        const result = await vyotiq.capture.screen({ workspaceId, sourceId });
        onCaptured({
          id: `capture-${Date.now()}`,
          name: result.relPath.split('/').pop() ?? result.relPath,
          mimeType: guessMimeFromName(result.relPath),
          mediaKind: 'image',
          workspacePath: result.relPath,
          sizeBytes: result.bytes
        });
        setOpen(false);
        showToast(`Capture saved → ${result.relPath}`, 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Capture failed.', 'danger');
      }
    },
    [conversationId, onCaptured, showToast]
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void loadSources()}
        aria-label="Capture screen or window"
        title="Capture screen or window"
        disabled={disabled || loading}
        className={cn(
          chromeToolbarButtonClassName(false),
          'h-[1.625rem] w-[1.625rem] shrink-0 px-0',
          (disabled || loading) && 'cursor-not-allowed opacity-45'
        )}
      >
        <Camera className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
      </button>
      {open && sources.length > 0 ? (
        <div className="elev-1 absolute bottom-full left-0 z-50 mb-1 max-h-48 w-64 overflow-y-auto rounded-inner border border-border-subtle/50 bg-surface-overlay p-1 shadow-lg">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              className="vx-btn vx-btn--ghost w-full justify-start truncate px-2 py-1 text-row text-text-secondary"
              onClick={() => void captureSource(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
