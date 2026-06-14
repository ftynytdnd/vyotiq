import { describe, expect, it } from 'vitest';
import { assertSettingsPatch } from '@main/ipc/settingsValidate';

describe('settingsValidate ui.recentEditorFilesByWorkspace', () => {
  it('accepts per-workspace recent editor path lists', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          recentEditorFilesByWorkspace: {
            'ws-1': ['C:\\Users\\admin\\project\\src\\App.tsx']
          }
        }
      })
    ).not.toThrow();
  });

  it('rejects more than eight paths per workspace', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          recentEditorFilesByWorkspace: {
            'ws-1': Array.from({ length: 9 }, (_, i) => `C:\\file${i}.ts`)
          }
        }
      })
    ).toThrow(/exceeds the 8 item cap/);
  });
});

describe('settingsValidate ui.workbenchPaneWidth', () => {
  it('accepts in-range workbench pane widths', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: { workbenchPaneWidth: 480 }
      })
    ).not.toThrow();
  });

  it('rejects out-of-range workbench pane widths', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: { workbenchPaneWidth: 200 }
      })
    ).toThrow();
  });
});
