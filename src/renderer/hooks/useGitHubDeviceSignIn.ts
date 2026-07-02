/**
 * GitHub OAuth Device Flow — shared by Open workspace dialog and Settings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatGitHubIpcError, GITHUB_OAUTH_NOT_CONFIGURED_MESSAGE } from '@shared/github/formatGitHubError.js';
import { vyotiq } from '../lib/ipc.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useToastStore } from '../store/useToastStore.js';

export function useGitHubDeviceSignIn(onConnected?: (accountId: string) => void) {
  const settingsClientId = useSettingsStore((s) => s.settings.ui?.githubOAuthClientId);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshOAuthStatus = useCallback(async () => {
    try {
      setOauthConfigured(await vyotiq.github.isOAuthConfigured());
    } catch {
      setOauthConfigured(false);
    }
  }, []);

  useEffect(() => {
    void refreshOAuthStatus();
  }, [settingsClientId, refreshOAuthStatus]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startDeviceFlow = useCallback(
    async (hostInput: string) => {
      if (oauthConfigured === false) {
        useToastStore.getState().show(GITHUB_OAUTH_NOT_CONFIGURED_MESSAGE, 'danger');
        return;
      }
      setDeviceBusy(true);
      setDeviceCode(null);
      try {
        const host = hostInput.trim() || 'github.com';
        const start = await vyotiq.github.startDeviceFlow(host);
        setDeviceCode(start.userCode);
        if (pollRef.current) clearInterval(pollRef.current);
        let intervalMs = Math.max(5, start.interval) * 1000;
        pollRef.current = setInterval(async () => {
          try {
            const result = await vyotiq.github.pollDeviceFlow(start.deviceCode, host);
            if (result.status === 'pending' || result.status === 'slow_down') {
              if (result.status === 'slow_down') intervalMs += 5000;
              return;
            }
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            if (result.status === 'success') {
              await refreshOAuthStatus();
              onConnected?.(result.account.id);
              useToastStore.getState().show(`Connected as ${result.account.login}`, 'success');
            } else if (result.status === 'denied') {
              useToastStore.getState().show('GitHub authorization denied.', 'danger');
            } else {
              useToastStore.getState().show('GitHub authorization expired. Try again.', 'danger');
            }
            setDeviceBusy(false);
            setDeviceCode(null);
          } catch (err) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDeviceBusy(false);
            setDeviceCode(null);
            useToastStore.getState().show(formatGitHubIpcError(err), 'danger');
          }
        }, intervalMs);
      } catch (err) {
        setDeviceBusy(false);
        useToastStore.getState().show(formatGitHubIpcError(err), 'danger');
      }
    },
    [oauthConfigured, onConnected, refreshOAuthStatus]
  );

  return {
    deviceBusy,
    deviceCode,
    oauthConfigured,
    refreshOAuthStatus,
    startDeviceFlow
  };
}
