import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { LoadingHint } from './components/ui/LoadingHint.js';
import { bootstrapChatChannel } from './store/chatChannel.js';
import { flushTimelineUiPersistence } from './store/useTimelineUiStore.js';
import { flushUiPersistence } from './store/useUiStore.js';
import './index.css';
import { applyAppTheme, readCachedThemePrefs } from './lib/theme.js';

applyAppTheme(readCachedThemePrefs());

void bootstrapChatChannel();

// After a dev rebuild or app update, lazy route chunks can 404. Retry
// once via `retryDynamicImport`; if preload still fails, debounce a
// single full reload so the user is not stuck on a blank shell.
let preloadReloadScheduled = false;
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (preloadReloadScheduled) return;
  preloadReloadScheduled = true;
  window.setTimeout(() => window.location.reload(), 150);
});

// Best-effort flush of any debounced UI persisters before the renderer
// tears down, so a toggle made within the last debounce window survives
// an app close. F-016 added the second call (layout chrome / collapsed
// workspaces); the timeline-ui flush has been here since the original
// expanded-rows persister landed.
window.addEventListener('beforeunload', () => {
  flushTimelineUiPersistence();
  flushUiPersistence();
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<LoadingHint className="flex h-full items-center justify-center" />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
