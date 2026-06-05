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
  it('persists and selects the model with effort', () => {
    const onChange = vi.fn();
    const updateProvider = vi.fn();
    applyThinkingEffortChange('p1', 'gpt-5', 'medium', onChange, updateProvider);
    expect(updateProvider).toHaveBeenCalledWith('p1', {
      modelThinking: { 'gpt-5': 'medium' }
    });
    expect(onChange).toHaveBeenCalledWith({
      providerId: 'p1',
      modelId: 'gpt-5',
      thinkingEffort: 'medium'
    });
  });

  it('selects the model even when it was not the active composer selection', () => {
    const onChange = vi.fn();
    const updateProvider = vi.fn();
    applyThinkingEffortChange('p1', 'gpt-5', 'high', onChange, updateProvider);
    expect(onChange).toHaveBeenCalledWith({
      providerId: 'p1',
      modelId: 'gpt-5',
      thinkingEffort: 'high'
    });
  });
});

describe('applyThinkingEffortClear', () => {
  it('clears stored override and session effort for the active model', () => {
    const onChange = vi.fn();
    const updateProvider = vi.fn();
    applyThinkingEffortClear('p1', 'gpt-5', onChange, updateProvider);
    expect(updateProvider).toHaveBeenCalledWith('p1', {
      modelThinking: { 'gpt-5': null }
    });
    expect(onChange).toHaveBeenCalledWith({ providerId: 'p1', modelId: 'gpt-5' });
  });
});
