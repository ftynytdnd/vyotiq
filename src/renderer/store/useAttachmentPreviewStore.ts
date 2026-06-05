import { create } from 'zustand';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';

interface AttachmentPreviewStore {
  attachment: PromptAttachmentMeta | null;
  open: (attachment: PromptAttachmentMeta) => void;
  close: () => void;
}

export const useAttachmentPreviewStore = create<AttachmentPreviewStore>((set) => ({
  attachment: null,
  open: (attachment) => {
    closeSettingsForCompanionOpen();
    set({ attachment });
  },
  close: () => set({ attachment: null })
}));
