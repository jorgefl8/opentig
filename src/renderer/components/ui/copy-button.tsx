import { useEffect, useState } from 'react';
import { IconCopy } from '@tabler/icons-react';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export function CopyButton({ value, label = 'Copy', onCopied, onError }: {
  value: string;
  label?: string;
  onCopied?: () => void;
  onError?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await writeClipboardText(value);
      setCopied(true);
      onCopied?.();
    } catch {
      setCopied(false);
      onError?.();
    }
  };

  return <>
    <Tooltip>
      <TooltipTrigger render={<button type="button" className="copy-button" aria-label={copied ? 'Copied' : label} data-copy-state={copied ? 'copied' : undefined} onClick={() => void copy()} />}>
        <IconCopy className="copy-button-icon" aria-hidden="true" />
        <span className="copy-button-check" aria-hidden="true">✓</span>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : label}</TooltipContent>
    </Tooltip>
    <span className="sr-only" role="status" aria-live="polite">{copied ? 'Copied' : ''}</span>
  </>;
}
