/**
 * CodeMirror 6 ghost-text inline completion (Tab accept, Escape dismiss).
 */

import {
  StateEffect,
  StateField,
  type Extension
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type ViewUpdate
} from '@codemirror/view';

export const setGhostText = StateEffect.define<string | null>();

interface GhostState {
  text: string | null;
  deco: DecorationSet;
}

export const ghostStateField = StateField.define<GhostState>({
  create: () => ({ text: null, deco: Decoration.none }),
  update(state, tr) {
    let text = state.text;
    for (const effect of tr.effects) {
      if (effect.is(setGhostText)) text = effect.value;
    }
    if (tr.docChanged) text = null;
    let deco = Decoration.none;
    if (text) {
      const pos = tr.state.selection.main.head;
      deco = Decoration.set([
        Decoration.widget({ widget: new GhostWidget(text), side: 1 }).range(pos)
      ]);
    }
    return { text, deco };
  },
  provide: (field) => EditorView.decorations.from(field, (state) => state.deco)
});

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'vx-inline-completion-ghost';
    el.textContent = this.text;
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export interface InlineCompletionFetchContext {
  prefix: string;
  suffix: string;
}

export interface InlineCompletionExtensionOptions {
  enabled: boolean;
  debounceMs: number;
  fetchCompletion: (ctx: InlineCompletionFetchContext) => Promise<string | null>;
  onDispose?: () => void;
}

const MIN_PREFIX_CHARS = 3;

/** CodeMirror forbids `view.dispatch` while a ViewPlugin `update` is running. */
function deferDispatch(view: EditorView, spec: Parameters<EditorView['dispatch']>[0]): void {
  queueMicrotask(() => {
    if (!view.dom.isConnected) return;
    view.dispatch(spec);
  });
}

function inlineCompletionKeymap(): Extension {
  return keymap.of([
    {
      key: 'Tab',
      run: (view) => {
        const ghost = view.state.field(ghostStateField).text;
        if (!ghost) return false;
        const pos = view.state.selection.main.head;
        view.dispatch({
          changes: { from: pos, insert: ghost },
          effects: setGhostText.of(null)
        });
        return true;
      }
    },
    {
      key: 'Escape',
      run: (view) => {
        const ghost = view.state.field(ghostStateField).text;
        if (!ghost) return false;
        view.dispatch({ effects: setGhostText.of(null) });
        return true;
      }
    }
  ]);
}

export function inlineCompletionExtension(
  options: InlineCompletionExtensionOptions
): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private seq = 0;
      private enabled: boolean;
      private debounceMs: number;
      private fetchCompletion: InlineCompletionExtensionOptions['fetchCompletion'];
      private onDispose?: () => void;

      constructor(_view: EditorView) {
        this.enabled = options.enabled;
        this.debounceMs = options.debounceMs;
        this.fetchCompletion = options.fetchCompletion;
        this.onDispose = options.onDispose;
      }

      update(update: ViewUpdate): void {
        this.enabled = options.enabled;
        this.debounceMs = options.debounceMs;
        this.fetchCompletion = options.fetchCompletion;
        this.onDispose = options.onDispose;
        if (!this.enabled) {
          this.clearTimer();
          if (update.view.state.field(ghostStateField).text) {
            deferDispatch(update.view, { effects: setGhostText.of(null) });
          }
          return;
        }
        const userDriven =
          update.transactions.some(
            (tr) =>
              tr.isUserEvent('input') ||
              tr.isUserEvent('input.type') ||
              tr.isUserEvent('input.paste') ||
              tr.isUserEvent('delete')
          ) ||
          (update.selectionSet &&
            update.transactions.some((tr) => tr.isUserEvent('select') || tr.isUserEvent('select.pointer')));
        if (userDriven && (update.docChanged || update.selectionSet)) {
          this.schedule(update.view);
        }
      }

      private clearTimer(): void {
        if (this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }

      private schedule(view: EditorView): void {
        this.clearTimer();
        deferDispatch(view, { effects: setGhostText.of(null) });
        if (!this.enabled) return;
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.run(view);
        }, this.debounceMs);
      }

      private async run(view: EditorView): Promise<void> {
        const seq = ++this.seq;
        const state = view.state;
        const pos = state.selection.main.head;
        const prefix = state.sliceDoc(Math.max(0, pos - 6000), pos);
        if (prefix.trim().length < MIN_PREFIX_CHARS) return;
        const suffix = state.sliceDoc(pos, Math.min(state.doc.length, pos + 2000));
        const text = await this.fetchCompletion({ prefix, suffix });
        if (seq !== this.seq || !text) return;
        if (view.state.selection.main.head !== pos) return;
        if (!view.dom.isConnected) return;
        view.dispatch({ effects: setGhostText.of(text) });
      }

      destroy(): void {
        this.clearTimer();
        this.seq++;
        this.onDispose?.();
      }
    }
  );

  return [ghostStateField, plugin, inlineCompletionKeymap()];
}
