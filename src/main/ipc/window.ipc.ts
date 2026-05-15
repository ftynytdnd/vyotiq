/**
 * Window control IPC. Frameless windows route min/max/close through here.
 */

import { BrowserWindow } from 'electron';
import { IPC } from '@shared/constants.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

export function registerWindowIpc(): void {
  wrapIpcHandler(IPC.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  wrapIpcHandler(IPC.WINDOW_MAXIMIZE_TOGGLE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  wrapIpcHandler(IPC.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  wrapIpcHandler(IPC.WINDOW_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
  wrapIpcHandler(IPC.WINDOW_RELOAD, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.reload();
  });
  wrapIpcHandler(IPC.WINDOW_TOGGLE_DEVTOOLS, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools();
  });
}
