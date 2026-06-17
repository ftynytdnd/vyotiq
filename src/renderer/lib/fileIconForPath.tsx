/**
 * File-type icons for dock tree and diff cards — VS Code Symbols theme.
 */

import { memo } from 'react';
import {
  DefaultFolderOpenedIcon,
  FileIcon,
  FolderIcon
} from '@react-symbols/icons/utils';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { cn } from './cn.js';

const DOCK_ICON_SIZE = 15;

const iconClassName = 'vx-dock-file-icon shrink-0';

function iconProps(className?: string) {
  return {
    width: DOCK_ICON_SIZE,
    height: DOCK_ICON_SIZE,
    className: cn(iconClassName, className)
  };
}

export interface FileIconForPathProps {
  filePath: string;
  isDir?: boolean;
  isExpanded?: boolean;
}

export const FileIconForPath = memo(function FileIconForPath({
  filePath,
  isDir = false,
  isExpanded = false
}: FileIconForPathProps) {
  if (isDir) {
    const folderName = basenameFromPath(filePath.replace(/\/$/, ''));
    if (isExpanded) {
      return <DefaultFolderOpenedIcon {...iconProps()} />;
    }
    return <FolderIcon folderName={folderName} {...iconProps()} />;
  }

  const fileName = basenameFromPath(filePath);
  return <FileIcon fileName={fileName} autoAssign {...iconProps()} />;
});
