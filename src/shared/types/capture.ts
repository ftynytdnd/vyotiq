/**
 * Screen/browser capture IPC types.
 */

export interface CaptureSourceInfo {
  id: string;
  name: string;
  thumbnailDataUrl?: string;
}

export interface CaptureScreenInput {
  workspaceId: string;
  sourceId: string;
}

export interface CaptureBrowserInput {
  workspaceId: string;
}

export interface CaptureWindowInput {
  workspaceId: string;
}

export interface CaptureResult {
  relPath: string;
  width: number;
  height: number;
  bytes: number;
}

export interface CaptureListSourcesResult {
  sources: CaptureSourceInfo[];
}
