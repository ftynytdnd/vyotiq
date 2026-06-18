/**

 * WorkbenchTabBar — on-demand unified scroll row with terminal + file tabs.

 */



import { render, screen } from '@testing-library/react';

import { beforeEach, describe, expect, it } from 'vitest';

import { WorkbenchTabBar } from '@renderer/components/workbench/WorkbenchTabBar';

import { useEditorStore } from '@renderer/store/useEditorStore';

import { useTerminalStore } from '@renderer/store/useTerminalStore';

import { useBrowserStore } from '@renderer/store/useBrowserStore';

import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

import { useUiStore } from '@renderer/store/useUiStore';



const SESSION = {

  sessionId: 's1',

  workspaceId: 'ws-1',

  shell: 'powershell',

  cols: 80,

  rows: 24,

  primary: true

};



describe('WorkbenchTabBar', () => {

  beforeEach(() => {

    useUiStore.setState({ workbenchTab: 'terminal' });

    useWorkspaceStore.setState({ activeId: 'ws-1' } as never);

    useBrowserStore.setState({ open: false } as never);

    useTerminalStore.setState({

      open: true,

      workspaceId: 'ws-1',

      sessions: [SESSION],

      activeSessionId: 's1',

      splitSessionId: null,

      attaching: false

    } as never);

    useEditorStore.setState({

      open: true,

      tabs: [

        {

          filePath: 'C:\\proj\\src\\main.py',

          workspaceId: 'ws-1',

          content: '',

          savedContent: '',

          mtimeMs: null,

          truncated: false,

          loading: false,

          saving: false,

          staleOnDisk: false,

          error: null,

          eol: 'lf',

          encoding: 'utf-8'

        }

      ],

      activeFilePath: 'C:\\proj\\src\\main.py'

    } as never);

  });



  it('renders open terminal + file tabs in one scroll row', () => {

    const { container } = render(<WorkbenchTabBar />);

    const scroll = container.querySelector('[data-workbench-tab-scroll]');

    expect(scroll).toBeTruthy();



    const tabLabels = Array.from(scroll!.querySelectorAll('[role="tab"]')).map((el) =>

      el.textContent?.trim()

    );

    expect(tabLabels).toEqual(expect.arrayContaining(['main.py']));
    expect(tabLabels).not.toEqual(expect.arrayContaining(['Terminal']));

    expect(screen.queryByRole('tab', { name: /^agent$/i })).toBeNull();

    expect(screen.getByRole('tab', { name: /main\.py/i })).toBeTruthy();

  });



  it('omits single-session terminal tab — titlebar owns panel switching', () => {

    useTerminalStore.setState({ sessions: [], activeSessionId: null } as never);

    render(<WorkbenchTabBar />);

    expect(screen.queryByRole('tab', { name: /^terminal$/i })).toBeNull();

  });



  it('omits empty editor tab — file tabs only', () => {
    useUiStore.setState({ workbenchTab: 'editor' });
    useEditorStore.setState({
      open: true,
      tabs: [],
      activeFilePath: null,
      dirtyPaths: new Set(),
      savingPaths: new Set()
    });
    render(<WorkbenchTabBar />);
    expect(screen.queryByRole('tab', { name: /^editor$/i })).toBeNull();
  });

  it('renders closable per-session tabs in the scroll row when multiple sessions', () => {

    useTerminalStore.setState({

      sessions: [

        SESSION,

        { ...SESSION, sessionId: 's2', primary: false }

      ]

    } as never);



    const { container } = render(<WorkbenchTabBar />);

    const scroll = container.querySelector('[data-workbench-tab-scroll]');

    const sessionTabs = scroll!.querySelectorAll('[role="tab"]');

    expect(sessionTabs).toHaveLength(3);

    expect(screen.getAllByRole('button', { name: /close powershell/i })).toHaveLength(2);

    expect(screen.getByRole('button', { name: /new shell/i })).toBeTruthy();

  });

});

