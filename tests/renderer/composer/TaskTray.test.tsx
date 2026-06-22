/**
 * Composer task tray — mount, add, status cycle, and IPC persistence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskTray } from '@renderer/components/composer/tasks/TaskTray';
import { TaskTrayHost } from '@renderer/components/composer/tasks/TaskTrayHost';
import { useTasksStore } from '@renderer/store/useTasksStore';
import type { TaskItem } from '@shared/types/task';

const tasks: TaskItem[] = [
  { id: '1', content: 'Ship feature', status: 'pending' },
  { id: '2', content: 'Write tests', status: 'in_progress' }
];

describe('TaskTray', () => {
  beforeEach(() => {
    useTasksStore.setState({ byConversation: {}, hydrateGeneration: {} });
    window.vyotiq.tasks.set = vi.fn(async (conversationId: string, items: TaskItem[]) => ({
      conversationId,
      items,
      updatedAt: Date.now()
    })) as never;
  });

  it('renders the tray region with progress summary', () => {
    render(<TaskTray conversationId="c1" tasks={tasks} />);

    expect(screen.getByTestId('task-tray')).toBeInTheDocument();
    expect(screen.getByText('0/2 done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tasks/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows task rows when expanded', async () => {
    const user = userEvent.setup();
    render(<TaskTray conversationId="c1" tasks={tasks} />);

    await user.click(screen.getByRole('button', { name: /Tasks/i }));

    expect(screen.getByText('Ship feature')).toBeInTheDocument();
    expect(screen.getByText('Write tests')).toBeInTheDocument();
  });

  it('adds a task and persists via tasks:set', async () => {
    const user = userEvent.setup();
    render(<TaskTray conversationId="c1" tasks={[]} />);

    const input = screen.getByPlaceholderText('Add a task…');
    await user.type(input, 'New task{Enter}');

    expect(window.vyotiq.tasks.set).toHaveBeenCalled();
    const [, items] = vi.mocked(window.vyotiq.tasks.set).mock.calls.at(-1)!;
    expect(items).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'New task', status: 'pending' })])
    );
  });

  it('cycles task status and demotes other in_progress items', async () => {
    const user = userEvent.setup();
    render(<TaskTray conversationId="c1" tasks={tasks} />);

    await user.click(screen.getByRole('button', { name: /Tasks/i }));
    await user.click(screen.getByRole('button', { name: /Status: Pending/i }));

    expect(window.vyotiq.tasks.set).toHaveBeenCalled();
    const [, items] = vi.mocked(window.vyotiq.tasks.set).mock.calls.at(-1)! as [string, TaskItem[]];
    expect(items.find((t) => t.id === '1')?.status).toBe('in_progress');
    expect(items.find((t) => t.id === '2')?.status).toBe('pending');
  });

  it('collapses and expands the task list', async () => {
    const user = userEvent.setup();
    render(<TaskTray conversationId="c1" tasks={tasks} />);

    const header = screen.getByRole('button', { name: /Tasks/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('Add a task…')).toBeInTheDocument();
  });
});

describe('TaskTrayHost', () => {
  beforeEach(() => {
    useTasksStore.setState({ byConversation: {}, hydrateGeneration: {} });
    window.vyotiq.tasks.get = vi.fn(async (conversationId: string) => ({
      conversationId,
      items: tasks,
      updatedAt: 1
    })) as never;
    window.vyotiq.tasks.set = vi.fn(async (conversationId: string, items: TaskItem[]) => ({
      conversationId,
      items,
      updatedAt: 2
    })) as never;
  });

  it('hydrates on mount and renders the tray for the active conversation', async () => {
    render(<TaskTrayHost conversationId="c1" />);

    expect(window.vyotiq.tasks.get).toHaveBeenCalledWith('c1');
    expect(await screen.findByTestId('task-tray')).toBeInTheDocument();
    expect(await screen.findByText('0/2 done')).toBeInTheDocument();
    expect(useTasksStore.getState().byConversation.c1).toEqual(tasks);
  });

  it('renders nothing without a conversation id', () => {
    const { queryByTestId } = render(<TaskTrayHost conversationId={null} />);
    expect(queryByTestId('task-tray')).toBeNull();
    expect(window.vyotiq.tasks.get).not.toHaveBeenCalled();
  });
});
