import { create } from 'zustand';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';
import {
  focusWorkbenchTab,
  syncWorkbenchTabAfterClose
} from '../components/workbench/workbenchShared.js';

interface AttachmentPreviewStore {
  attachment: PromptAttachmentMeta | null;
  open: (attachment: PromptAttachmentMeta) => void;
  close: () => void;
}

export const useAttachmentPreviewStore = create<AttachmentPreviewStore>((set) => ({
  attachment: null,
  open: (attachment) => {
    closeSettingsForCompanionOpen();
    focusWorkbenchTab('preview');
    set({ attachment });
  },
  close: () => {
    set({ attachment: null });
    syncWorkbenchTabAfterClose();
  }
}));
