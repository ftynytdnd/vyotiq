import { describe, expect, it } from 'vitest';
import {
  createSpinSignatureBuffer,
  pushToolRound,
  resetSpinBuffer,
  spinHotSignature,
  toolCallSignature
} from '@main/orchestrator/loop/toolSpinSignature.js';

describe('toolSpinSignature', () => {
  it('surfaces hot signature after three identical rounds without reset', () => {
    const spin = createSpinSignatureBuffer();
    const sig = toolCallSignature('read', { path: 'src/foo.ts' });

    pushToolRound(spin, [sig]);
    expect(spinHotSignature(spin)).toBeNull();

    pushToolRound(spin, [sig]);
    expect(spinHotSignature(spin)).toBeNull();

    pushToolRound(spin, [sig]);
    expect(spinHotSignature(spin)).toBe(sig);
  });

  it('returns null when the window mixes signatures', () => {
    const spin = createSpinSignatureBuffer();
    const a = toolCallSignature('read', { path: 'a.ts' });
    const b = toolCallSignature('read', { path: 'b.ts' });

    pushToolRound(spin, [a]);
    pushToolRound(spin, [a]);
    pushToolRound(spin, [b]);

    expect(spinHotSignature(spin)).toBeNull();
  });

  it('resetSpinBuffer clears hot detection', () => {
    const spin = createSpinSignatureBuffer();
    const sig = toolCallSignature('ls', { path: '.' });
    pushToolRound(spin, [sig]);
    pushToolRound(spin, [sig]);
    pushToolRound(spin, [sig]);
    expect(spinHotSignature(spin)).toBe(sig);

    resetSpinBuffer(spin);
    expect(spinHotSignature(spin)).toBeNull();
  });
});
