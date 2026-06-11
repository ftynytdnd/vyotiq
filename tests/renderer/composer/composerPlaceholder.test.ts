import { describe, expect, it } from 'vitest';
import {
  COMPOSER_DRAFT_PLACEHOLDER,
  COMPOSER_DEFAULT_PLACEHOLDER,
  COMPOSER_LANDING_PLACEHOLDER,
  resolveComposerPlaceholder
} from '@renderer/components/composer/composerPlaceholder';

describe('resolveComposerPlaceholder', () => {
  it('returns landing copy on empty landing', () => {
    expect(
      resolveComposerPlaceholder({
        landing: true,
        storeDraft: '',
        editorPlain: '',
        eventsLength: 0
      })
    ).toBe(COMPOSER_LANDING_PLACEHOLDER);
  });

  it('returns draft hint when store has draft but editor is empty', () => {
    expect(
      resolveComposerPlaceholder({
        landing: true,
        storeDraft: 'Saved draft',
        editorPlain: '',
        eventsLength: 0
      })
    ).toBe(COMPOSER_DRAFT_PLACEHOLDER);
  });

  it('returns default copy when not landing', () => {
    expect(
      resolveComposerPlaceholder({
        landing: false,
        storeDraft: '',
        editorPlain: '',
        eventsLength: 0
      })
    ).toBe(COMPOSER_DEFAULT_PLACEHOLDER);
  });
});
