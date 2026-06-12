import { cn } from '../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../lib/shimmer.js';
import { useConversationProcessing } from '../../hooks/chat/index.js';

interface RunningTitleProps {
  id: string;
  title: string;
  className?: string;
}

export function RunningTitle({ id, title, className }: RunningTitleProps) {
  const { isRunActive } = useConversationProcessing(id);
  return (
    <span
      className={shimmerText(isRunActive, cn('min-w-0 flex-1 truncate', className))}
      style={isRunActive ? shimmerStyle(`conv:${id}`) : undefined}
      title={title}
    >
      {title}
    </span>
  );
}
