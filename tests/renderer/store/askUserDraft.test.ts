import { beforeEach, describe, expect, it } from 'vitest';
import { useAskUserDraftStore, resetAskUserDraftsForTests } from '@renderer/store/askUserDraft';

const payload = {
  questions: [
    {
      id: 'frameworks',
      prompt: 'Which frameworks?',
      allow_multiple: true,
      options: [
        { id: 'react', label: 'React' },
        { id: 'vue', label: 'Vue' },
        { id: 'svelte', label: 'Svelte' }
      ]
    }
  ]
};

describe('useAskUserDraftStore allow_multiple', () => {
  beforeEach(() => {
    resetAskUserDraftsForTests();
    useAskUserDraftStore.getState().ensureDraft('prompt-1', payload);
  });

  it('toggles multiple options independently', () => {
    const store = useAskUserDraftStore.getState();
    store.toggleOption('prompt-1', 'frameworks', 'react', true);
    store.toggleOption('prompt-1', 'frameworks', 'vue', true);
    expect(
      useAskUserDraftStore.getState().byPromptId['prompt-1']!.frameworks!.selected
    ).toEqual(new Set(['react', 'vue']));

    store.toggleOption('prompt-1', 'frameworks', 'react', true);
    expect(
      useAskUserDraftStore.getState().byPromptId['prompt-1']!.frameworks!.selected
    ).toEqual(new Set(['vue']));
  });

  it('buildAnswers preserves multi-select ids', () => {
    const store = useAskUserDraftStore.getState();
    store.toggleOption('prompt-1', 'frameworks', 'react', true);
    store.toggleOption('prompt-1', 'frameworks', 'svelte', true);
    const answers = store.buildAnswers('prompt-1', payload);
    expect(answers[0]?.selectedOptionIds).toEqual(['react', 'svelte']);
  });
});
