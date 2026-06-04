import { describe, expect, it, vi } from 'vitest';
import {
  applyThinkingEffortChange,
  applyThinkingEffortClear,
  rowThinkingEffort
} from '@renderer/components/composer/modelPicker/modelPickerThinking';
import type { ProviderConfig } from '@shared/types/provider';

describe('rowThinkingEffort', () => {
  it('prefers session override for the active model', () => {
    const provider = {
      id: 'p1',
      dialect: 'openai',
      modelThinking: { 'gpt-5': 'low' }
    } as ProviderConfig;
    expect(
      rowThinkingEffort(provider, 'gpt-5', {
        providerId: 'p1',
        modelId: 'gpt-5',
        thinkingEffort: 'high'
      })
    ).toBe('high');
  });
});

describe('applyThinkingEffortChange', () => {
  it('persists and updates selection when the row is active', () => {
    const onChange = vi.fn();
    const updateProvider = vi.fn();
    applyThinkingEffortChange(
      'p1',
      'gpt-5',
      'medium',
      { providerId: 'p1', modelId: 'gpt-5' },
      onChange,
      updateProvider
    );
    expect(updateProvider).toHaveBeenCalledWith('p1', {
      modelThinking: { 'gpt-5': 'medium' }
    });
    expect(onChange).toHaveBeenCalledWith({
      providerId: 'p1',
      modelId: 'gpt-5',
      thinkingEffort: 'medium'
    });
  });
});

describe('applyThinkingEffortClear', () => {
  it('clears stored override and session effort for the active model', () => {
    const onChange = vi.fn();
    const updateProvider = vi.fn();
    applyThinkingEffortClear(
      'p1',
      'gpt-5',
      { providerId: 'p1', modelId: 'gpt-5', thinkingEffort: 'high' },
      onChange,
      updateProvider
    );
    expect(updateProvider).toHaveBeenCalledWith('p1', {
      modelThinking: { 'gpt-5': null }
    });
    expect(onChange).toHaveBeenCalledWith({ providerId: 'p1', modelId: 'gpt-5' });
  });
});
