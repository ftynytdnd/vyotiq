import { create } from 'zustand';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { useSecondaryZoneStore } from './useSecondaryZoneStore.js';

interface AttachmentPreviewStore {
  attachment: PromptAttachmentMeta | null;
  open: (attachment: PromptAttachmentMeta) => void;
  close: () => void;
}

export const useAttachmentPreviewStore = create<AttachmentPreviewStore>((set) => ({
  attachment: null,
  open: (attachment) => {
    useSecondaryZoneStore.getState().closeForCompanionOpen();
    set({ attachment });
  },
  close: () => set({ attachment: null })
}));
