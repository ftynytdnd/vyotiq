import { describe, expect, it } from 'vitest';
import {
  COMPOSER_ASK_USER_PLACEHOLDER,
  COMPOSER_DEFAULT_PLACEHOLDER,
  COMPOSER_DRAFT_PLACEHOLDER,
  COMPOSER_EDIT_QUEUED_PLACEHOLDER,
  COMPOSER_LANDING_PLACEHOLDER,
  COMPOSER_PROCESSING_PLACEHOLDER,
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

  it('returns default copy when idle in an active chat', () => {
    expect(
      resolveComposerPlaceholder({
        landing: false,
        storeDraft: '',
        editorPlain: '',
        eventsLength: 0
      })
    ).toBe(COMPOSER_DEFAULT_PLACEHOLDER);
  });

  it('returns short processing copy during an active run', () => {
    expect(
      resolveComposerPlaceholder({
        landing: false,
        storeDraft: '',
        editorPlain: '',
        eventsLength: 2,
        isProcessing: true
      })
    ).toBe(COMPOSER_PROCESSING_PLACEHOLDER);
    expect(COMPOSER_PROCESSING_PLACEHOLDER).toBe('@ to mention files…');
  });

  it('returns ask-user supplement copy for any pending reply', () => {
    expect(
      resolveComposerPlaceholder({
        landing: false,
        storeDraft: '',
        editorPlain: '',
        eventsLength: 2,
        needsAskUserReply: true
      })
    ).toBe(COMPOSER_ASK_USER_PLACEHOLDER);
    expect(COMPOSER_ASK_USER_PLACEHOLDER).toMatch(/Optional prose/i);
    expect(COMPOSER_ASK_USER_PLACEHOLDER).toMatch(/Queue defers/i);
  });

  it('returns edit-queued copy when a queued follow-up is open in the composer', () => {
    expect(
      resolveComposerPlaceholder({
        landing: false,
        storeDraft: '',
        editorPlain: '',
        eventsLength: 2,
        isProcessing: true,
        editingQueued: true
      })
    ).toBe(COMPOSER_EDIT_QUEUED_PLACEHOLDER);
  });

  it('prefers ask-user copy over processing when both are set', () => {
    expect(
      resolveComposerPlaceholder({
        landing: false,
        storeDraft: '',
        editorPlain: '',
        eventsLength: 2,
        isProcessing: true,
        needsAskUserReply: true
      })
    ).toBe(COMPOSER_ASK_USER_PLACEHOLDER);
  });
});
