import { IconHistory } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** In an open file's bar: the commits that changed it, in History. */
export function FileHistoryButton({ path, onOpen }: { path: string; onOpen(path: string): void }) {
  const name = path.split('/').pop() ?? path;
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" className="file-history-button" aria-label={`History of ${name}`} onClick={() => onOpen(path)} />}>
        <IconHistory />
      </TooltipTrigger>
      <TooltipContent>File history</TooltipContent>
    </Tooltip>
  );
}
