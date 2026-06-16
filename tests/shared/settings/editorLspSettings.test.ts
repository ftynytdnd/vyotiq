import { describe, expect, it } from 'vitest';
import { resolveEditorLspSettings } from '@shared/settings/editorLspSettings.js';

describe('resolveEditorLspSettings', () => {
  it('defaults enabled to true when editorLsp is absent', () => {
    expect(resolveEditorLspSettings(undefined).enabled).toBe(true);
    expect(resolveEditorLspSettings({}).enabled).toBe(true);
  });

  it('respects explicit disabled', () => {
    expect(resolveEditorLspSettings({ editorLsp: { enabled: false } }).enabled).toBe(false);
  });
});
