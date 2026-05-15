import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { bootstrapChatChannel } from './store/chatChannel.js';
import { flushTimelineUiPersistence } from './store/useTimelineUiStore.js';
import { flushUiPersistence } from './store/useUiStore.js';
import './index.css';

bootstrapChatChannel();

// Best-effort flush of any debounced UI persisters before the renderer
// tears down, so a toggle made within the last debounce window survives
// an app close. F-016 added the second call (sidebar / collapsed
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
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
