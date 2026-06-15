/**
 * File-type icon for dock tree and diff cards.
 */

import {
  File,
  FileCode2,
  FileJson,
  FileText,
  FileImage,
  Folder
} from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { cn } from './cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from './shellIcons.js';

const ICON_CLASS = cn(SHELL_ROW_ICON_CLASS, 'shrink-0');
const STROKE = SHELL_ACTION_ICON_STROKE;

export function fileIconForPath(filePath: string, isDir = false) {
  if (isDir) {
    return <Folder className={cn(ICON_CLASS, 'text-text-secondary')} strokeWidth={STROKE} />;
  }

  const base = basenameFromPath(filePath).toLowerCase();
  if (base.endsWith('.json')) {
    return <FileJson className={cn(ICON_CLASS, 'text-accent/90')} strokeWidth={STROKE} />;
  }
  if (/\.(md|mdx|txt|log)$/.test(base)) {
    return <FileText className={cn(ICON_CLASS, 'text-text-secondary')} strokeWidth={STROKE} />;
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(base)) {
    return <FileImage className={cn(ICON_CLASS, 'text-text-secondary')} strokeWidth={STROKE} />;
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cs|cpp|c|h|rb|php|swift|vue|svelte|sql|sh|bash|zsh|yml|yaml|toml|css|scss|less|html?|xml)$/.test(base)) {
    return <FileCode2 className={cn(ICON_CLASS, 'text-accent/80')} strokeWidth={STROKE} />;
  }
  return <File className={cn(ICON_CLASS, 'text-text-primary')} strokeWidth={STROKE} />;
}
