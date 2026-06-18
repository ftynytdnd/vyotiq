import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useModelPickerCollisionPadding } from '@renderer/components/composer/modelPicker/useModelPickerCollisionPadding';
import { useUiStore } from '@renderer/store/useUiStore';

beforeEach(() => {
  useUiStore.setState({ dockExpanded: false, dockWidth: 260 });
});

describe('useModelPickerCollisionPadding', () => {
  it('uses edge inset only when flyout is collapsed', () => {
    const { result } = renderHook(() => useModelPickerCollisionPadding());
    expect(result.current.left).toBe(12);
    expect(result.current.right).toBe(12);
  });

  it('expands left inset when dock flyout is open', () => {
    useUiStore.setState({ dockExpanded: true, dockWidth: 260 });
    const { result } = renderHook(() => useModelPickerCollisionPadding());
    expect(result.current.left).toBe(260 + 12);
  });
});
