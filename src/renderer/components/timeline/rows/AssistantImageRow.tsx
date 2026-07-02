import { useCallback, useEffect, useMemo, useState } from 'react';
import { vyotiq } from '../../../lib/ipc.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { openAttachment } from '../../../lib/openAttachment.js';
import { timelineAgentColumnClassName } from '../shared/rowStyles.js';

interface AssistantImageRowProps {
  id: string;
  mime: string;
  storedPath: string;
}

export function AssistantImageRow({ id, mime, storedPath }: AssistantImageRowProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const showToast = useToastStore((s) => s.show);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const pathInput = useMemo(
    () =>
      workspaceId
        ? { path: storedPath, workspaceId }
        : null,
    [storedPath, workspaceId]
  );

  useEffect(() => {
    if (!pathInput) {
      setFileUrl(null);
      return;
    }
    let cancelled = false;
    void vyotiq.attachments.fileUrl(pathInput).then((next) => {
      if (!cancelled) setFileUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pathInput]);

  const onOpen = useCallback(() => {
    void openAttachment(
      {
        id,
        name: storedPath.split('/').pop() ?? storedPath,
        mimeType: mime,
        workspacePath: storedPath
      },
      workspaceId
    );
  }, [id, mime, storedPath, workspaceId]);

  const onSave = useCallback(async () => {
    if (!workspaceId) return;
    try {
      await vyotiq.workspace.revealPath({ path: storedPath, workspaceId });
      showToast(`Saved under ${storedPath}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reveal image.', 'danger');
    }
  }, [showToast, storedPath, workspaceId]);

  return (
    <div className={timelineAgentColumnClassName} data-row-kind="assistant-image">
      <button
        type="button"
        className="vx-attachment-card vx-attachment-card--image block max-w-xs overflow-hidden rounded-inner border border-border-subtle/40"
        onClick={onOpen}
        title={storedPath}
      >
        {fileUrl ? (
          <img
            src={fileUrl}
            alt={storedPath}
            className="vx-attachment-card__thumb max-h-48 w-auto object-contain"
          />
        ) : (
          <span
            className="vx-attachment-card__thumb vx-attachment-card__thumb--placeholder block min-h-24"
            aria-hidden
          />
        )}
      </button>
      <div className="mt-1 flex gap-2">
        <button type="button" className="vx-btn vx-btn-text text-row" onClick={onOpen}>
          Preview
        </button>
        <button type="button" className="vx-btn vx-btn-text text-row" onClick={() => void onSave()}>
          Reveal in workspace
        </button>
      </div>
    </div>
  );
}
