/**

 * DOM focus callbacks for open workbench companion panes.

 */



import type { CompanionTab } from '../components/workbench/workbenchShared.js';



let terminalFocus: (() => void) | null = null;

let editorFocus: (() => void) | null = null;

let browserUrlFocus: (() => void) | null = null;

let previewFocus: (() => void) | null = null;

let sourceControlFocus: (() => void) | null = null;



export function registerTerminalDomFocus(fn: () => void): () => void {

  terminalFocus = fn;

  return () => {

    if (terminalFocus === fn) terminalFocus = null;

  };

}



export function registerEditorDomFocus(fn: () => void): () => void {

  editorFocus = fn;

  return () => {

    if (editorFocus === fn) editorFocus = null;

  };

}



export function registerBrowserUrlDomFocus(fn: () => void): () => void {

  browserUrlFocus = fn;

  return () => {

    if (browserUrlFocus === fn) browserUrlFocus = null;

  };

}



export function registerPreviewDomFocus(fn: () => void): () => void {

  previewFocus = fn;

  return () => {

    if (previewFocus === fn) previewFocus = null;

  };

}



export function registerSourceControlDomFocus(fn: () => void): () => void {

  sourceControlFocus = fn;

  return () => {

    if (sourceControlFocus === fn) sourceControlFocus = null;

  };

}



/** Focus the DOM surface for the active workbench companion tab. */

export function focusActiveWorkbenchDom(tab: CompanionTab): void {

  const run = () => {

    switch (tab) {

      case 'terminal':

        terminalFocus?.();

        break;

      case 'editor':

        editorFocus?.();

        break;

      case 'browser':

        browserUrlFocus?.();

        break;

      case 'preview':

        previewFocus?.();

        break;

      case 'source-control':

        sourceControlFocus?.();

        break;

      default: {

        const _exhaustive: never = tab;

        return _exhaustive;

      }

    }

  };

  requestAnimationFrame(() => {

    requestAnimationFrame(run);

  });

}

