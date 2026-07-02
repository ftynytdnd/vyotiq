/**

 * Floating `ask_user` overlay — host-report gate and multi-question agent prompts.

 */



import { useEffect, useRef } from 'react';

import { resolveAskUserTitle } from '@shared/askUser/askUserCopy.js';

import { cn } from '../../../lib/cn.js';

import { bindFocusTrap, focusFirstFocusable } from '../../../lib/focusTrap.js';

import { appComposerShellClassName } from '../../ui/SurfaceShell.js';

import type { PendingAskUserEvent } from '../../../lib/pendingAskUser.js';

import { AskUserForm } from './AskUserForm.js';



interface AskUserOverlayProps {

  pending: PendingAskUserEvent;

}



export function AskUserOverlay({ pending }: AskUserOverlayProps) {

  const isHostGate = pending.source === 'host-report-gate';

  const overlayRef = useRef<HTMLDivElement>(null);

  const previouslyFocusedRef = useRef<HTMLElement | null>(null);



  useEffect(() => {

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const raf = requestAnimationFrame(() => {

      const root = overlayRef.current;

      if (root) focusFirstFocusable(root);

    });

    return () => {

      cancelAnimationFrame(raf);

      const prev = previouslyFocusedRef.current;

      if (prev && document.body.contains(prev)) prev.focus();

    };

  }, [pending.id]);



  useEffect(() => {

    return bindFocusTrap({

      getRoot: () => overlayRef.current,

      disableEscape: true

    });

  }, [pending.id]);



  return (

    <div

      ref={overlayRef}

      className={cn(

        'vx-composer-dialog vx-ask-user-overlay vyotiq-composer-dialog-enter mb-2 flex flex-col',

        appComposerShellClassName,

        isHostGate && 'vx-ask-user-overlay--host-gate'

      )}

      role="dialog"

      aria-modal="true"

      aria-label={isHostGate ? 'Generate HTML report' : resolveAskUserTitle(pending.payload)}

      data-ask-user-overlay

    >

      <AskUserForm pending={pending} variant="overlay" />

    </div>

  );

}

