/**
 * Screen/browser capture IPC types.
 */

export interface CaptureSourceInfo {
  id: string;
  name: string;
  thumbnailDataUrl?: string;
}

export interface CaptureListSourcesInput {
  thumbnails?: boolean;
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

export interface CaptureIngestFrameInput {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  png: Uint8Array;
  width: number;
  height: number;
  prefix?: string;
}

export interface CaptureFrameRequestEvent {
  requestId: string;
  sourceId: string;
}

export interface CaptureFrameResultInput {
  requestId: string;
  ok: boolean;
  png?: Uint8Array;
  width?: number;
  height?: number;
  error?: string;
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
