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

  it('clears selected options when typing a custom answer on single-select', () => {
    const singlePayload = {
      questions: [
        {
          id: 'pick',
          prompt: 'Pick one',
          options: [{ id: 'a', label: 'Alpha' }]
        }
      ]
    };
    useAskUserDraftStore.getState().ensureDraft('prompt-2', singlePayload);
    const store = useAskUserDraftStore.getState();
    store.toggleOption('prompt-2', 'pick', 'a', false);
    store.setFreeText('prompt-2', 'pick', 'custom', false);
    const sheet = useAskUserDraftStore.getState().byPromptId['prompt-2']!.pick!;
    expect(sheet.selected.size).toBe(0);
    expect(sheet.freeText).toBe('custom');
  });

  it('clears free text when selecting an option on single-select', () => {
    const singlePayload = {
      questions: [
        {
          id: 'pick',
          prompt: 'Pick one',
          options: [{ id: 'a', label: 'Alpha' }]
        }
      ]
    };
    useAskUserDraftStore.getState().ensureDraft('prompt-3', singlePayload);
    const store = useAskUserDraftStore.getState();
    store.setFreeText('prompt-3', 'pick', 'custom', false);
    store.toggleOption('prompt-3', 'pick', 'a', false);
    const sheet = useAskUserDraftStore.getState().byPromptId['prompt-3']!.pick!;
    expect(sheet.freeText).toBe('');
    expect(sheet.selected).toEqual(new Set(['a']));
  });

  it('countAnswered includes selections, free text, and skips', () => {
    const store = useAskUserDraftStore.getState();
    expect(store.countAnswered('prompt-1', payload)).toBe(0);
    store.toggleOption('prompt-1', 'frameworks', 'react', true);
    expect(store.countAnswered('prompt-1', payload)).toBe(1);
    store.setFreeText('prompt-1', 'frameworks', 'other', true);
    expect(store.countAnswered('prompt-1', payload)).toBe(1);
    store.skipQuestion('prompt-1', 'frameworks');
    expect(store.countAnswered('prompt-1', payload)).toBe(1);
  });
});
