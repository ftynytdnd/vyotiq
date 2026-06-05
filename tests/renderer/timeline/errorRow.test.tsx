import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorRow } from '@renderer/components/timeline/rows/ErrorRow';

describe('ErrorRow', () => {
  it('renders merged run meta when duration is provided', () => {
    render(
      <ErrorRow
        message="Provider failed."
        durationMs={8400}
        completedAt={Date.parse('2026-06-05T20:24:00')}
      />
    );
    expect(screen.getByText(/done in 8\.4s/i)).toBeInTheDocument();
  });

  it('renders retry and providers actions when supplied', () => {
    const onRetry = vi.fn();
    const onOpenProviders = vi.fn();
    render(
      <ErrorRow
        message="The provider failed 3 times in a row."
        onRetry={onRetry}
        onOpenProviders={onOpenProviders}
        showProviders
      />
    );
    expect(screen.getByText(/provider failed/i)).toBeInTheDocument();
    screen.getByRole('button', { name: /retry last message/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: /open providers/i }).click();
    expect(onOpenProviders).toHaveBeenCalledTimes(1);
  });
});
