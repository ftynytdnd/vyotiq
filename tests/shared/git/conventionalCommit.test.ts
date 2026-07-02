import { describe, expect, it } from 'vitest';
import {
  hasNaturalLanguageBody,
  isQualityCommitMessage,
  isRoboticBulletBody,
  isValidConventionalCommitMessage,
  isValidConventionalSubject,
  sanitizeModelCommitMessage,
  stripCommitMessageBoilerplate
} from '../../../src/shared/git/conventionalCommit.js';

describe('conventionalCommit', () => {
  it('validates conventional subjects', () => {
    expect(isValidConventionalSubject('feat(ui): add source control panel')).toBe(true);
    expect(isValidConventionalSubject('fix!: drop legacy API')).toBe(true);
    expect(isValidConventionalSubject('random commit message')).toBe(false);
    expect(isValidConventionalSubject('feat: ends with period.')).toBe(false);
  });

  it('strips markdown fences and labels', () => {
    const raw = '```\nfeat(api): add endpoint\n\n- detail\n```';
    expect(stripCommitMessageBoilerplate(raw)).toBe('feat(api): add endpoint\n\n- detail');
    expect(stripCommitMessageBoilerplate('Commit message: chore: bump deps')).toBe('chore: bump deps');
  });

  it('sanitizes and validates full messages', () => {
    const msg = sanitizeModelCommitMessage(
      '```\nfeat(landing): add Next.js scaffold\n\nThis introduces the landing app.\n```'
    );
    expect(isValidConventionalCommitMessage(msg)).toBe(true);
    expect(msg).toContain('feat(landing): add Next.js scaffold');
  });

  it('detects robotic checklist bodies', () => {
    const robotic =
      'feat(app): add dashboard\n\n- add Dashboard.tsx\n- add Sidebar.tsx\n- add StatCard.tsx';
    expect(isRoboticBulletBody(robotic)).toBe(true);
    expect(hasNaturalLanguageBody(robotic)).toBe(false);
  });

  it('accepts prose bodies for quality check', () => {
    const prose = `feat(app): add dashboard

This introduces a signed-in dashboard where operators can review agent activity.
The layout uses a shared sidebar and stat cards on the home route.`;
    expect(hasNaturalLanguageBody(prose)).toBe(true);
    expect(isQualityCommitMessage(prose, { fileCount: 12 })).toBe(true);
  });
});
