import { ArrowUp, Square } from 'lucide-react';

import { cn } from '../../lib/cn.js';

import {

  SHELL_CHROME_ICON_CLASS,

  SHELL_CHROME_ICON_STROKE,

  SHELL_MICRO_ICON_CLASS,

  SHELL_MICRO_ICON_STROKE

} from '../../lib/shellIcons.js';



interface SendButtonProps {

  onClick: () => void;

  state: 'idle' | 'ready' | 'processing';

  disabled?: boolean;

}



export function SendButton({ onClick, state, disabled }: SendButtonProps) {

  const isProcessing = state === 'processing';

  const isReady = state === 'ready';



  return (

    <button

      type="button"

      onClick={onClick}

      disabled={disabled}

      aria-label={isProcessing ? 'Stop' : 'Send'}

      title={isProcessing ? 'Stop' : 'Send'}

      className={cn(

        'vx-btn app-no-drag h-6 w-6 shrink-0 px-0',

        'disabled:cursor-not-allowed',

        isProcessing

          ? 'vx-btn-primary bg-surface-overlay/60'

          : isReady

            ? 'vx-btn-accent-fill'

            : 'vx-btn-quiet'

      )}

    >

      {isProcessing ? (

        <Square className={cn(SHELL_MICRO_ICON_CLASS, 'fill-current')} strokeWidth={SHELL_MICRO_ICON_STROKE} />

      ) : (

        <ArrowUp className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />

      )}

    </button>

  );

}

